/**
 * outbox workerのCLIエントリポイント。cross-tenantのポーリングループを起動し、SIGTERM/SIGINTで
 * グレースフルシャットダウンする（server.tsと同じ方針）
 *
 * 【重要】M1時点ではeventTypeごとの実handlerが1つも登録されていない（GCS/Slack/freee連携はM2以降）。
 * このまま実行すると、既存のM1向けイベント（document.draft_generated等。冪等性チェック目的のみで
 * 外部反映は不要）が「no handler registered」で即dead判定される。dead判定はidempotencyの正しさには
 * 影響しないが、監視上のノイズになるため、M2で実handlerを登録するまでは本番スケジューラ（Cloud Run Jobs等）
 * への定期実行登録を行わないこと。詳細は docs/registry-readiness-checklist.md 参照
 *
 * CLI entrypoint for the outbox worker. Starts the cross-tenant polling loop and shuts down gracefully on
 * SIGTERM/SIGINT (same policy as server.ts).
 *
 * IMPORTANT: As of M1, no real per-eventType handler is registered yet (GCS/Slack/freee integrations land in
 * M2+). Running this as-is will immediately dead-letter the existing M1 events (e.g. document.draft_generated,
 * which exist only for idempotency bookkeeping and need no external side effect). Dead-lettering does not affect
 * idempotency correctness, but it is monitoring noise — do not wire this into a production scheduler (Cloud Run
 * Jobs, etc.) until M2 registers real handlers. See docs/registry-readiness-checklist.md
 *
 * Entrypoint CLI untuk outbox worker. Memulai loop polling cross-tenant dan shutdown secara graceful saat
 * SIGTERM/SIGINT (kebijakan yang sama dengan server.ts).
 *
 * PENTING: Pada M1, belum ada handler nyata per eventType yang terdaftar (integrasi GCS/Slack/freee baru masuk
 * di M2+). Menjalankan ini apa adanya akan langsung men-dead-letter event M1 yang ada (misalnya
 * document.draft_generated, yang hanya ada untuk pembukuan idempotensi dan tidak memerlukan efek samping
 * eksternal). Dead-lettering tidak memengaruhi kebenaran idempotensi, tetapi menjadi noise monitoring — jangan
 * hubungkan ini ke scheduler produksi (Cloud Run Jobs, dll.) sampai M2 mendaftarkan handler nyata. Lihat
 * docs/registry-readiness-checklist.md
 */
import { db, getPool } from "../../db/client.js";
import { logMessage } from "../../lib/logger.js";
import type { OutboxHandler } from "./worker.js";
import { processOutboxBatchForAllTenants } from "./worker.js";

const POLL_INTERVAL_MS = 2000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

// M2でGCS/Slack/freee連携のhandlerをここへ追加登録する（eventType文字列は各serviceのenqueueOutboxEvent呼び出しを参照）
// M2 will register GCS/Slack/freee integration handlers here (see each service's enqueueOutboxEvent call for eventType strings)
// M2 akan mendaftarkan handler integrasi GCS/Slack/freee di sini (lihat panggilan enqueueOutboxEvent tiap service untuk string eventType)
const handlers: Record<string, OutboxHandler> = {};

async function main(): Promise<void> {
  if (Object.keys(handlers).length === 0) {
    logMessage(
      "warning",
      "handlerが1つも登録されていません。既存のoutboxイベントは即座にdead判定されます。M2でhandlerを登録するまで本番スケジューラに接続しないこと / No handlers are registered; existing outbox events will be dead-lettered immediately. Do not connect this to a production scheduler until M2 registers handlers",
    );
  }

  logMessage("info", "outbox workerを起動しました / outbox worker started");

  // shouldStopをループ内でポーリングすることで、setTimeout待機中でもSIGTERM/SIGINTを速やかに反映できる
  // Polling shouldStop inside the loop lets SIGTERM/SIGINT take effect promptly even while awaiting the interval sleep
  // Memoll shouldStop di dalam loop memungkinkan SIGTERM/SIGINT berlaku cepat meskipun sedang menunggu interval sleep
  let shouldStop = false;
  let forceExitTimer: NodeJS.Timeout | undefined;
  function shutdown(signal: string): void {
    logMessage("info", `${signal}を受信。outbox workerを停止します / received ${signal}, stopping the outbox worker`);
    shouldStop = true;
    // グレースフルシャットダウンが完了すればmain()側でclearTimeoutするため、このタイマーは
    // ハング時のフェイルセーフとしてのみ発火する
    // main() clears this once graceful shutdown completes, so this timer only fires as a hang failsafe
    // main() membersihkan ini setelah shutdown graceful selesai, jadi timer ini hanya menyala sebagai failsafe saat hang
    forceExitTimer = setTimeout(() => {
      logMessage("critical", "シャットダウンがタイムアウトしたため強制終了します / shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  while (!shouldStop) {
    try {
      const result = await processOutboxBatchForAllTenants(db, handlers, 10);
      if (result.processed > 0 || result.failed > 0) {
        logMessage("info", "outboxバッチを処理しました / processed an outbox batch", result);
      }
    } catch (error) {
      logMessage("error", "outboxバッチ処理中にエラーが発生しました / an error occurred while processing an outbox batch", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (forceExitTimer) {
    clearTimeout(forceExitTimer);
  }
  await getPool().end();
  logMessage("info", "outbox workerを停止しました / outbox worker stopped");
  process.exit(0);
}

main().catch((error: unknown) => {
  logMessage("critical", "outbox workerが予期せず停止しました / outbox worker stopped unexpectedly", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

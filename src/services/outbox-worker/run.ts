/**
 * outbox workerのCLIエントリポイント。cross-tenantのポーリングループを起動し、SIGTERM/SIGINTで
 * グレースフルシャットダウンする（server.tsと同じ方針）
 *
 * 【自社MVPゲート時点の状況（docs/registry-readiness-checklist.md G節）】
 * 文書バイト本体のGCS/MinIOへの保存はgenerate-draft.ts／attach-executed-copy.tsが
 * putImmutableObject経由で既に同期的に行っており、outbox handlerとしての追加実装は不要（正本は既にGCS/MinIOにある）。
 * outboxで実際に必要なのは非同期の通知（Slack）のみだったため、document.approval_requestedに
 * notifySlackOnApprovalRequestedを登録した。それ以外のeventType（document.draft_generated・
 * dispatch_assignment.confirmed等）は現時点で外部反映不要（冪等性チェック目的のみ）のため、
 * handler未登録のまま「no handler registered」でdeadになる（dead-letterの監視は運用ランブック参照）。
 * freee連携（invoice.create_draft等）はMVP外（下記checklist E節）のため登録しない
 *
 * CLI entrypoint for the outbox worker. Starts the cross-tenant polling loop and shuts down gracefully on
 * SIGTERM/SIGINT (same policy as server.ts).
 *
 * As of the internal-MVP gate (docs/registry-readiness-checklist.md section G): the document bytes themselves are
 * already stored to GCS/MinIO synchronously by generate-draft.ts / attach-executed-copy.ts via putImmutableObject,
 * so no outbox handler is needed for that (the artifact of record already lives in GCS/MinIO). The only thing the
 * outbox genuinely needed was an async notification (Slack), so notifySlackOnApprovalRequested is registered for
 * document.approval_requested. Other eventTypes (document.draft_generated, dispatch_assignment.confirmed, etc.)
 * currently need no external side effect (they exist only for idempotency bookkeeping) and are intentionally left
 * unregistered, so they dead-letter with "no handler registered" (see the ops runbook for dead-letter monitoring).
 * freee integration (invoice.create_draft, etc.) is out of MVP scope (checklist section E) and is not registered
 *
 * Entrypoint CLI untuk outbox worker. Memulai loop polling cross-tenant dan shutdown secara graceful saat
 * SIGTERM/SIGINT (kebijakan yang sama dengan server.ts).
 */
import { db, getPool } from "../../db/client.js";
import { logMessage } from "../../lib/logger.js";
import { notifySlackOnApprovalRequested } from "./handlers/slack-approval-notifier.js";
import type { OutboxHandler } from "./worker.js";
import { processOutboxBatchForAllTenants } from "./worker.js";

const POLL_INTERVAL_MS = 2000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

const handlers: Record<string, OutboxHandler> = {
  "document.approval_requested": notifySlackOnApprovalRequested,
};

async function main(): Promise<void> {
  logMessage("info", "outbox workerを起動しました / outbox worker started", {
    registeredEventTypes: Object.keys(handlers),
  });

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

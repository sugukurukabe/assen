/**
 * 冪等worker本体（§2.2）。pendingイベントをFOR UPDATE SKIP LOCKEDで取得し、
 * eventType別ハンドラを実行する。失敗時は指数バックオフで再試行し、上限超過でdeadにする
 * Idempotent worker core (§2.2). Fetches pending events with FOR UPDATE SKIP LOCKED and
 * dispatches to a per-eventType handler. Failures retry with exponential backoff and move to dead after the limit
 * Inti worker idempotent (§2.2). Mengambil event pending dengan FOR UPDATE SKIP LOCKED dan
 * mendispatch ke handler per-eventType. Kegagalan mencoba ulang dengan backoff eksponensial dan menjadi dead setelah batas
 */
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { tenantSettings } from "../../db/schema/tenant.js";
import { acquireTenantScopedDb } from "../../db/client.js";
import { logMessage } from "../../lib/logger.js";

type Db = NodePgDatabase<typeof schema>;

// transactional_outboxはRLSで`tenant_id = current_setting('app.tenant_id')`に強制される設計になっている
// （001_enable_rls.sql）ため、テナントを固定しない接続は本番のRLS強制ロールでは既存行が一切見えないはずである。
// cross-tenantなworkerはRLSをバイパスする特権ロールに頼らず、RLSを持たないtenant_settingsからテナント一覧を
// 取得し、テナントごとにapp.tenant_idを設定した接続で処理する設計にしている。
// 【既知の制約】ただし現時点のローカル開発ロール（assen）はsuperuser兼RLSバイパス権限を持つため、この分離が
// 実際に効いているかはローカルでは検証できていない（test/outbox-multi-tenant.test.ts参照）。本番ロールを
// 非superuser・RLS強制で用意した上での検証がdocs/registry-readiness-checklist.mdのM3ゲート対象
// transactional_outbox is designed to be RLS-enforced to `tenant_id = current_setting('app.tenant_id')`
// (001_enable_rls.sql), so a connection with no tenant pinned should see zero rows under a properly RLS-enforcing
// production role. Rather than relying on an RLS-bypassing privileged role, the cross-tenant worker enumerates
// tenants from tenant_settings (which carries no RLS) and processes each tenant through a connection that pins
// app.tenant_id.
// KNOWN LIMITATION: the current local dev role (assen) is a superuser with RLS bypass, so this isolation cannot
// actually be verified locally today (see test/outbox-multi-tenant.test.ts). Verifying it once a non-superuser,
// RLS-enforcing production role exists is tracked under the M3 gate in docs/registry-readiness-checklist.md
// transactional_outbox dirancang agar diberlakukan RLS ke `tenant_id = current_setting('app.tenant_id')`
// (001_enable_rls.sql), sehingga koneksi tanpa tenant yang dipatok seharusnya tidak melihat baris apa pun di
// bawah role produksi yang benar-benar menegakkan RLS. Daripada mengandalkan role istimewa yang melewati RLS,
// worker cross-tenant mendaftar tenant dari tenant_settings (yang tidak memiliki RLS) dan memproses setiap tenant
// melalui koneksi yang mematok app.tenant_id.
// KETERBATASAN YANG DIKETAHUI: role dev lokal saat ini (assen) adalah superuser dengan bypass RLS, sehingga
// isolasi ini belum dapat diverifikasi secara lokal hari ini (lihat test/outbox-multi-tenant.test.ts).
// Memverifikasinya setelah role produksi non-superuser yang menegakkan RLS tersedia dilacak di bawah gate M3 pada
// docs/registry-readiness-checklist.md

export type OutboxHandler = (event: {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  externalReference: string | null;
}) => Promise<void>;

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 1000;

function computeBackoffMs(attemptCount: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attemptCount, 5 * 60 * 1000);
}

/**
 * pending（かつ再試行時刻が来ている）イベントを最大batchSize件取得し、1件ずつ処理する
 * Fetches up to batchSize pending events whose retry time has arrived, and processes them one by one
 * Mengambil hingga batchSize event pending yang waktu retry-nya sudah tiba, dan memprosesnya satu per satu
 */
export async function processOutboxBatch(
  db: Db,
  handlers: Record<string, OutboxHandler>,
  batchSize = 10,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  const claimed = await db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(transactionalOutbox)
      .where(
        and(
          eq(transactionalOutbox.status, "pending"),
          or(isNull(transactionalOutbox.nextRetryAt), lte(transactionalOutbox.nextRetryAt, new Date())),
        ),
      )
      .orderBy(asc(transactionalOutbox.createdAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    if (candidates.length > 0) {
      await tx
        .update(transactionalOutbox)
        .set({ status: "processing" })
        .where(
          sql`${transactionalOutbox.id} in (${sql.join(
            candidates.map((row) => sql`${row.id}`),
            sql`, `,
          )})`,
        );
    }
    return candidates;
  });

  for (const row of claimed) {
    const handler = handlers[row.eventType];
    if (!handler) {
      logMessage("warning", "ハンドラ未登録のイベントをdeadにします / marking event with no registered handler as dead", {
        eventType: row.eventType,
        id: row.id,
      });
      await db.update(transactionalOutbox).set({ status: "dead", lastError: "no handler registered" }).where(eq(transactionalOutbox.id, row.id));
      failed += 1;
      continue;
    }

    try {
      await handler({
        id: row.id,
        tenantId: row.tenantId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        payload: row.payload,
        externalReference: row.externalReference,
      });
      await db.update(transactionalOutbox).set({ status: "done" }).where(eq(transactionalOutbox.id, row.id));
      processed += 1;
    } catch (error) {
      const attemptCount = row.attemptCount + 1;
      const isDead = attemptCount >= MAX_ATTEMPTS;
      await db
        .update(transactionalOutbox)
        .set({
          status: isDead ? "dead" : "pending",
          attemptCount,
          nextRetryAt: isDead ? null : new Date(Date.now() + computeBackoffMs(attemptCount)),
          lastError: error instanceof Error ? error.message : String(error),
        })
        .where(eq(transactionalOutbox.id, row.id));
      logMessage("error", "outboxイベント処理に失敗しました / outbox event processing failed", {
        id: row.id,
        eventType: row.eventType,
        attemptCount,
        isDead,
      });
      failed += 1;
    }
  }

  return { processed, failed };
}

/**
 * ポーリングループ本体（単一テナント固定のdbを渡す用途／テスト用）。本番のcross-tenant workerは
 * runMultiTenantOutboxWorkerLoopを使うこと
 * Polling loop entrypoint for a caller that already has a single tenant-pinned db (mainly for tests). The
 * production cross-tenant worker should use runMultiTenantOutboxWorkerLoop instead
 * Entrypoint loop polling untuk pemanggil yang sudah memiliki db yang dipatok satu tenant (terutama untuk test).
 * Worker cross-tenant produksi sebaiknya memakai runMultiTenantOutboxWorkerLoop
 */
export async function runOutboxWorkerLoop(
  db: Db,
  handlers: Record<string, OutboxHandler>,
  intervalMs = 2000,
): Promise<never> {
  for (;;) {
    await processOutboxBatch(db, handlers);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * tenant_settingsに登録済みのテナントID一覧を返す（RLSなしのテーブルなので、テナント固定なしの接続でも全件見える）
 * Returns the tenant ids registered in tenant_settings (no RLS on this table, so an unpinned connection sees all rows)
 * Mengembalikan daftar tenant id yang terdaftar di tenant_settings (tabel ini tidak ber-RLS, jadi koneksi tanpa
 * tenant yang dipatok tetap melihat semua baris)
 */
export async function listActiveTenantIds(unscopedDb: Db): Promise<string[]> {
  const rows = await unscopedDb.select({ tenantId: tenantSettings.tenantId }).from(tenantSettings);
  return rows.map((row) => row.tenantId);
}

/**
 * 全テナントのpendingイベントを1バッチずつ処理する。テナントごとに専用コネクションでapp.tenant_idを設定してから
 * processOutboxBatchを呼ぶため、テナント間のRLS分離を保ったままcross-tenantに処理できる
 * Processes one batch of pending events across all tenants. Opens a dedicated connection per tenant with
 * app.tenant_id pinned before calling processOutboxBatch, so cross-tenant processing never weakens RLS isolation
 * Memproses satu batch event pending di semua tenant. Membuka koneksi khusus per tenant dengan app.tenant_id yang
 * dipatok sebelum memanggil processOutboxBatch, sehingga pemrosesan cross-tenant tidak pernah melemahkan isolasi RLS
 */
export async function processOutboxBatchForAllTenants(
  unscopedDb: Db,
  handlers: Record<string, OutboxHandler>,
  batchSize = 10,
): Promise<{ processed: number; failed: number; tenantsProcessed: number }> {
  const tenantIds = await listActiveTenantIds(unscopedDb);
  let processed = 0;
  let failed = 0;

  for (const tenantId of tenantIds) {
    const tenantScoped = await acquireTenantScopedDb(tenantId);
    try {
      const result = await processOutboxBatch(tenantScoped.db, handlers, batchSize);
      processed += result.processed;
      failed += result.failed;
    } finally {
      tenantScoped.release();
    }
  }

  return { processed, failed, tenantsProcessed: tenantIds.length };
}

/**
 * cross-tenantのポーリングループ本体。tenant_settingsに登録されたテナントを毎サイクル再取得するため、
 * テナント追加が実行中に反映される
 * Cross-tenant polling loop entrypoint. Re-fetches tenants registered in tenant_settings every cycle, so newly
 * added tenants are picked up while running
 * Entrypoint loop polling cross-tenant. Mengambil ulang tenant yang terdaftar di tenant_settings setiap siklus,
 * sehingga tenant baru yang ditambahkan langsung terdeteksi saat berjalan
 */
export async function runMultiTenantOutboxWorkerLoop(
  unscopedDb: Db,
  handlers: Record<string, OutboxHandler>,
  intervalMs = 2000,
): Promise<never> {
  for (;;) {
    const result = await processOutboxBatchForAllTenants(unscopedDb, handlers, 10);
    if (result.processed > 0 || result.failed > 0) {
      logMessage("info", "outboxバッチを処理しました / processed an outbox batch", result);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

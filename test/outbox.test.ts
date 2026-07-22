/**
 * transactional outboxの単体テスト：同一idempotencyKeyの再実行で副作用が1回のみになることを確認する
 * Unit test for the transactional outbox: confirms retries with the same idempotencyKey cause only one side effect
 * Unit test untuk transactional outbox: memastikan retry dengan idempotencyKey yang sama hanya menyebabkan satu efek samping
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, getPool, type TenantScopedDb } from "../src/db/client.js";
import { transactionalOutbox } from "../src/db/schema/outbox.js";
import { enqueueOutboxEvent } from "../src/services/outbox-worker/enqueue.js";
import { processOutboxBatch } from "../src/services/outbox-worker/worker.js";

// 各テストは自分専用のtenantIdでacquireTenantScopedDbを取得する（本番と同じRLS強制ロールで動くことを前提にしている
// ため、他テストのpending行はapp.tenant_idが異なる限りRLSで見えず、FIFOの位置に関わらず混ざらない）
// Each test acquires its own tenant-scoped connection via acquireTenantScopedDb (assuming the RLS-enforcing
// production role). RLS hides other tests' pending rows whenever app.tenant_id differs, regardless of FIFO position
// Setiap test memperoleh koneksi tenant-scoped sendiri via acquireTenantScopedDb (mengasumsikan role produksi yang
// menegakkan RLS). RLS menyembunyikan baris pending test lain kapan pun app.tenant_id berbeda, tanpa memandang posisi FIFO
let tenantScoped: TenantScopedDb | undefined;

afterEach(() => {
  tenantScoped?.release();
  tenantScoped = undefined;
});

afterAll(async () => {
  await getPool().end();
});

describe("transactional outbox", () => {
  it("同一idempotencyKeyでの複数回投入は1行にまとまる / multiple enqueues with the same idempotencyKey collapse into one row", async () => {
    const idempotencyKey = randomUUID();
    const tenantId = randomUUID();
    tenantScoped = await acquireTenantScopedDb(tenantId);
    const { db } = tenantScoped;

    for (let i = 0; i < 3; i += 1) {
      await db.transaction(async (tx) => {
        await enqueueOutboxEvent(tx, {
          tenantId,
          aggregateType: "document",
          aggregateId: randomUUID(),
          eventType: "test.noop",
          payload: { attempt: i },
          idempotencyKey,
        });
      });
    }

    const rows = await db.select().from(transactionalOutbox).where(eq(transactionalOutbox.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it("ハンドラが成功すればstatusがdoneになる / status becomes done when the handler succeeds", async () => {
    const idempotencyKey = randomUUID();
    const tenantId = randomUUID();
    tenantScoped = await acquireTenantScopedDb(tenantId);
    const { db } = tenantScoped;
    let callCount = 0;

    await db.transaction(async (tx) => {
      await enqueueOutboxEvent(tx, {
        tenantId,
        aggregateType: "document",
        aggregateId: randomUUID(),
        eventType: "test.succeed",
        payload: {},
        idempotencyKey,
      });
    });

    await processOutboxBatch(db, {
      "test.succeed": () => {
        callCount += 1;
        return Promise.resolve();
      },
    });

    const [row] = await db.select().from(transactionalOutbox).where(eq(transactionalOutbox.idempotencyKey, idempotencyKey));
    expect(row?.status).toBe("done");
    expect(callCount).toBe(1);
  });

  it("ハンドラが失敗すると再試行スケジュールされる / a failing handler schedules a retry", async () => {
    const idempotencyKey = randomUUID();
    const tenantId = randomUUID();
    tenantScoped = await acquireTenantScopedDb(tenantId);
    const { db } = tenantScoped;

    await db.transaction(async (tx) => {
      await enqueueOutboxEvent(tx, {
        tenantId,
        aggregateType: "document",
        aggregateId: randomUUID(),
        eventType: "test.fail",
        payload: {},
        idempotencyKey,
      });
    });

    await processOutboxBatch(db, {
      "test.fail": () => Promise.reject(new Error("intentional failure")),
    });

    const [row] = await db.select().from(transactionalOutbox).where(eq(transactionalOutbox.idempotencyKey, idempotencyKey));
    expect(row?.status).toBe("pending");
    expect(row?.attemptCount).toBe(1);
    expect(row?.nextRetryAt).not.toBeNull();
  });
});

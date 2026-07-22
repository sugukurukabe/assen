/**
 * transactional outboxへの投入（§2.2）。呼び出し側は業務状態の変更と同一トランザクション内で呼ぶこと
 * Enqueues into the transactional outbox (§2.2). Callers must invoke this within the same transaction as the business state change
 * Memasukkan ke transactional outbox (§2.2). Pemanggil harus memanggil ini dalam transaksi yang sama dengan perubahan status bisnis
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";

type DbOrTx = NodePgDatabase<typeof schema>;

export interface EnqueueOutboxEventInput {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  // 同一操作の再実行で副作用を1回に保つための冪等キー / Idempotency key that keeps retries of the same operation to a single side effect / Kunci idempotensi yang menjaga pengulangan operasi yang sama tetap satu efek samping
  idempotencyKey: string;
  externalReference?: string;
}

/**
 * outboxイベントを投入する。idempotencyKeyが重複する場合は既存行を無視して何もしない（同一操作の再実行対策）
 * Enqueues an outbox event. If idempotencyKey already exists, the insert is a no-op (guards retries of the same operation)
 * Memasukkan event outbox. Jika idempotencyKey sudah ada, insert menjadi no-op (menjaga dari pengulangan operasi yang sama)
 */
export async function enqueueOutboxEvent(tx: DbOrTx, input: EnqueueOutboxEventInput): Promise<void> {
  await tx
    .insert(transactionalOutbox)
    .values({
      tenantId: input.tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      externalReference: input.externalReference,
    })
    .onConflictDoNothing({ target: transactionalOutbox.idempotencyKey });
}

/**
 * job_order_referral.confirmの中核処理：確定済みの求人（job_orders）・求職者（job_seekers）を紐付け、
 * 紹介行（job_order_referrals）を作成する（帳簿①②の接点＝紹介欄へのposting、§4.2・§7）。
 * conditionsTypedには④求人条件明示書・⑤本人同意書の差込用項目を受け取る（src/domain/t2p-referral-conditions.ts参照）
 *
 * Core logic for job_order_referral.confirm: links a confirmed job order (job_orders) and job seeker
 * (job_seekers), creating the referral row (job_order_referrals) — the Ledger #1/#2 junction, i.e. the
 * "referral columns" posting (§4.2, §7). conditionsTyped accepts the ④ (job-order notice) and ⑤ (consent
 * form) fields (see src/domain/t2p-referral-conditions.ts)
 *
 * Logika inti job_order_referral.confirm: menghubungkan lowongan yang dikonfirmasi (job_orders) dan
 * pencari kerja (job_seekers), membuat baris rujukan (job_order_referrals) — titik temu Buku Besar #1/#2,
 * yaitu posting "kolom rujukan" (§4.2, §7). conditionsTyped menerima field ④ (pemberitahuan lowongan) dan
 * ⑤ (formulir persetujuan) (lihat src/domain/t2p-referral-conditions.ts)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobOrderReferrals, jobOrders, jobSeekers } from "../../db/schema/ledgers.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { enqueueOutboxEvent } from "../outbox-worker/enqueue.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface ConfirmJobOrderReferralInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  idempotencyKey: string;
  reason: string;
  jobOrderId: string;
  jobSeekerId: string;
  referredAt: string;
  type: "t2p" | "pure" | "direct";
  // ④⑤書類差込用の法定項目（部分入力可・doc-type-registry.tsのschemaでdocType生成時に検証） / Statutory items for ④⑤ (partial input allowed; validated against the docType's schema at generation time) / Item wajib untuk ④⑤ (input parsial diperbolehkan; divalidasi terhadap skema docType saat generate)
  conditionsTyped?: Record<string, unknown>;
  // dispatch_assignment.confirmで確定した⑥T2P個別契約書（t2pFlag=true）のID（任意・後から紐付け可） / Id of the ⑥ T2P individual contract (t2pFlag=true) confirmed via dispatch_assignment.confirm (optional; can be linked later) / Id kontrak individual T2P ⑥ (t2pFlag=true) yang dikonfirmasi via dispatch_assignment.confirm (opsional; dapat dihubungkan nanti)
  dispatchAssignmentId?: string;
}

export interface ConfirmJobOrderReferralResult {
  jobOrderReferralId: string;
  alreadyProcessed: boolean;
}

export async function confirmJobOrderReferral(db: Db, input: ConfirmJobOrderReferralInput): Promise<ConfirmJobOrderReferralResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing?.externalReference) {
      return { jobOrderReferralId: existing.externalReference, alreadyProcessed: true };
    }

    const [jobOrder] = await tx.select().from(jobOrders).where(eq(jobOrders.id, input.jobOrderId));
    if (!jobOrder) {
      throw new UserInputError(
        `job_order ${input.jobOrderId} が見つかりません / job_order ${input.jobOrderId} not found`,
        "jobOrderIdを確認してください（job_order.confirmで確定済みである必要があります） / Please verify jobOrderId (must be finalized via job_order.confirm)",
      );
    }

    const [jobSeeker] = await tx.select().from(jobSeekers).where(eq(jobSeekers.id, input.jobSeekerId));
    if (!jobSeeker) {
      throw new UserInputError(
        `job_seeker ${input.jobSeekerId} が見つかりません / job_seeker ${input.jobSeekerId} not found`,
        "jobSeekerIdを確認してください（job_seeker.confirmで確定済みである必要があります） / Please verify jobSeekerId (must be finalized via job_seeker.confirm)",
      );
    }

    const jobOrderReferralId = randomUUID();
    await tx.insert(jobOrderReferrals).values({
      id: jobOrderReferralId,
      tenantId: input.tenantId,
      jobOrderId: input.jobOrderId,
      jobSeekerId: input.jobSeekerId,
      referredAt: input.referredAt,
      outcome: "pending",
      type: input.type,
      phase: "F2",
      dispatchAssignmentId: input.dispatchAssignmentId,
      conditionsTyped: input.conditionsTyped ?? {},
    });

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_order_referral",
      aggregateId: jobOrderReferralId,
      aggregateVersion: 1,
      eventType: "job_order_referral.confirmed",
      afterHash: sha256Hex(
        canonicalJsonString({ jobOrderReferralId, jobOrderId: input.jobOrderId, jobSeekerId: input.jobSeekerId, type: input.type }),
      ),
      principal: input.principal,
      requestId: input.requestId,
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_order_referral",
      aggregateId: jobOrderReferralId,
      eventType: "job_order_referral.confirmed",
      payload: { jobOrderReferralId, jobOrderId: input.jobOrderId, jobSeekerId: input.jobSeekerId, reason: input.reason },
      idempotencyKey: input.idempotencyKey,
      externalReference: jobOrderReferralId,
    });

    return { jobOrderReferralId, alreadyProcessed: false };
  });
}

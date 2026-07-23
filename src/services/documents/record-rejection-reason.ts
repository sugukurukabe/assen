/**
 * placement.record_rejection_reasonの中核処理：outcome=rejected確定済みの紹介行に、派遣先から受領した
 * 不採用理由（⑧に対する回答）をtyped column（rejectionReason・rejectionReasonReceivedAt）へ記録する。
 * ⑨不採用理由の書面明示の生成前提となる（§4.2・§7、domain/t2p-non-hire-reason-notice.ts参照）。
 * additionalDetails（⑨のnonHireCategory等、rejectionReason以外の項目）はconditionsTypedへマージする
 *
 * Core logic for placement.record_rejection_reason: records the non-hire reason received from the client
 * (the reply to document ⑧) into typed columns (rejectionReason, rejectionReasonReceivedAt) on a referral
 * row already confirmed as outcome=rejected. This is the precondition for generating document ⑨ (see §4.2,
 * §7, domain/t2p-non-hire-reason-notice.ts). additionalDetails (⑨ fields other than rejectionReason, e.g.
 * nonHireCategory) are merged into conditionsTyped
 *
 * Logika inti placement.record_rejection_reason: mencatat alasan tidak diterima yang diterima dari klien
 * (balasan atas dokumen ⑧) ke kolom bertipe (rejectionReason, rejectionReasonReceivedAt) pada baris rujukan
 * yang sudah dikonfirmasi outcome=rejected. Ini adalah prasyarat untuk menghasilkan dokumen ⑨ (lihat §4.2,
 * §7, domain/t2p-non-hire-reason-notice.ts). additionalDetails (field ⑨ selain rejectionReason, misalnya
 * nonHireCategory) digabung ke conditionsTyped
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobOrderReferrals } from "../../db/schema/ledgers.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { enqueueOutboxEvent } from "../outbox-worker/enqueue.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface RecordRejectionReasonInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  idempotencyKey: string;
  reason: string;
  jobOrderReferralId: string;
  rejectionReason: string;
  rejectionReasonReceivedAt: string;
  // ⑨のrejectionReason以外の差込項目（nonHireCategory・noticeDate・noticeMethod等） / ⑨ fields other than rejectionReason (nonHireCategory, noticeDate, noticeMethod, etc.) / Field ⑨ selain rejectionReason (nonHireCategory, noticeDate, noticeMethod, dll.)
  additionalDetails?: Record<string, unknown>;
}

export interface RecordRejectionReasonResult {
  jobOrderReferralId: string;
  alreadyProcessed: boolean;
}

export async function recordRejectionReason(db: Db, input: RecordRejectionReasonInput): Promise<RecordRejectionReasonResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing?.externalReference) {
      return { jobOrderReferralId: existing.externalReference, alreadyProcessed: true };
    }

    const [referral] = await tx.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, input.jobOrderReferralId));
    if (!referral) {
      throw new UserInputError(
        `job_order_referral ${input.jobOrderReferralId} が見つかりません / job_order_referral ${input.jobOrderReferralId} not found`,
        "jobOrderReferralIdを確認してください / Please verify jobOrderReferralId",
      );
    }
    if (referral.outcome !== "rejected") {
      throw new UserInputError(
        `job_order_referral ${input.jobOrderReferralId} はoutcome=rejectedで確定していません（現在: ${referral.outcome}） / job_order_referral ${input.jobOrderReferralId} is not confirmed as outcome=rejected (current: ${referral.outcome})`,
        "先にplacement.confirmでoutcome=rejectedを確定してください / Please first confirm outcome=rejected via placement.confirm",
      );
    }

    const existingConditions = (referral.conditionsTyped as Record<string, unknown> | null) ?? {};

    await tx
      .update(jobOrderReferrals)
      .set({
        rejectionReason: input.rejectionReason,
        rejectionReasonReceivedAt: input.rejectionReasonReceivedAt,
        conditionsTyped: { ...existingConditions, ...input.additionalDetails },
      })
      .where(eq(jobOrderReferrals.id, input.jobOrderReferralId));

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_order_referral",
      aggregateId: input.jobOrderReferralId,
      aggregateVersion: 3,
      eventType: "placement.rejection_reason_recorded",
      afterHash: sha256Hex(
        canonicalJsonString({ jobOrderReferralId: input.jobOrderReferralId, rejectionReasonReceivedAt: input.rejectionReasonReceivedAt }),
      ),
      principal: input.principal,
      requestId: input.requestId,
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_order_referral",
      aggregateId: input.jobOrderReferralId,
      eventType: "placement.rejection_reason_recorded",
      payload: { jobOrderReferralId: input.jobOrderReferralId, reason: input.reason },
      idempotencyKey: input.idempotencyKey,
      externalReference: input.jobOrderReferralId,
    });

    return { jobOrderReferralId: input.jobOrderReferralId, alreadyProcessed: false };
  });
}

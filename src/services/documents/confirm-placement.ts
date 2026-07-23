/**
 * placement.confirmの中核処理：紹介行（job_order_referrals）の採否（hired/rejected）を確定する
 * （「採否理由チェーン」の起点、§4.2・§7）。
 * hired時：転職勧奨禁止期間（採用日から2年）を自動計算し、party snapshot（takenReason: "placement_confirm"）を
 * 作成、⑦転換条件覚書の差込項目をconditionsTypedへ追記（マージ）し、fee_records（帳簿③）へpostingする。
 * rejected時：⑧不採用理由の明示請求の差込項目をconditionsTypedへ追記する（回答は
 * placement.record_rejection_reasonが別途typed columnへ記録し、⑨生成の前提とする）
 *
 * Core logic for placement.confirm: finalizes the hiring outcome (hired/rejected) of a referral row
 * (job_order_referrals) — the entry point of the "non-hire reason chain" (§4.2, §7).
 * When hired: auto-computes the no-poaching period (2 years from hire date), creates a party snapshot
 * (takenReason: "placement_confirm"), appends (merges) the ⑦ conversion-memo fields into conditionsTyped,
 * and posts Ledger #3 (fee_records). When rejected: appends the ⑧ non-hire-reason-request fields into
 * conditionsTyped (the reply itself is recorded separately via placement.record_rejection_reason into a
 * typed column, the precondition for generating ⑨)
 *
 * Logika inti placement.confirm: finalisasi hasil perekrutan (hired/rejected) dari baris rujukan
 * (job_order_referrals) — titik awal "rantai alasan tidak diterima" (§4.2, §7).
 * Saat diterima: menghitung otomatis periode larangan pembajakan (2 tahun dari tanggal perekrutan),
 * membuat snapshot pihak (takenReason: "placement_confirm"), menambahkan (menggabung) field memo
 * konversi ⑦ ke conditionsTyped, dan posting Buku Besar #3 (fee_records). Saat ditolak: menambahkan
 * field permintaan alasan tidak diterima ⑧ ke conditionsTyped (balasannya sendiri dicatat secara
 * terpisah via placement.record_rejection_reason ke kolom bertipe, prasyarat untuk membuat ⑨)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { feeRecords, jobOrderReferrals } from "../../db/schema/ledgers.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { createPartySnapshot } from "./party-snapshot.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { enqueueOutboxEvent } from "../outbox-worker/enqueue.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

// 転職勧奨禁止期間（採用日から2年） / No-poaching period: 2 years from hire date / Periode larangan pembajakan: 2 tahun dari tanggal perekrutan
const NO_POACHING_YEARS = 2;

function addYears(isoDate: string, years: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

export interface EmployerSnapshotInput {
  companyId: string;
  name: string;
  address: string;
  representative: string;
  contactPerson: string;
}

export interface FeeInput {
  feeType: "uketsuke" | "todokede" | "jogen";
  amountInclTax: number;
  calcBasisWage?: number;
  calcBasisRate?: number;
  collectedAt?: string;
}

export interface ConfirmPlacementHiredInput {
  outcome: "hired";
  hiredAt: string;
  indefiniteEmployment: boolean;
  employer: EmployerSnapshotInput;
  // ⑦転換条件覚書の差込項目（conditionsTypedへマージ） / ⑦ conversion-memo fields (merged into conditionsTyped) / Field memo konversi ⑦ (digabung ke conditionsTyped)
  conversionTerms: Record<string, unknown>;
  fee: FeeInput;
}

export interface ConfirmPlacementRejectedInput {
  outcome: "rejected";
  // ⑧不採用理由の明示請求の差込項目（conditionsTypedへマージ） / ⑧ non-hire-reason-request fields (merged into conditionsTyped) / Field permintaan alasan tidak diterima ⑧ (digabung ke conditionsTyped)
  nonHireRequestDetails: Record<string, unknown>;
}

export type ConfirmPlacementOutcomeInput = ConfirmPlacementHiredInput | ConfirmPlacementRejectedInput;

export interface ConfirmPlacementInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  idempotencyKey: string;
  reason: string;
  jobOrderReferralId: string;
  outcomeInput: ConfirmPlacementOutcomeInput;
}

export interface ConfirmPlacementResult {
  jobOrderReferralId: string;
  feeRecordId?: string;
  noPoachingUntil?: string;
  alreadyProcessed: boolean;
}

export async function confirmPlacement(db: Db, input: ConfirmPlacementInput): Promise<ConfirmPlacementResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing?.externalReference) {
      const [existingReferral] = await tx.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, existing.externalReference));
      const [existingFee] = await tx.select().from(feeRecords).where(eq(feeRecords.referralId, existing.externalReference));
      return {
        jobOrderReferralId: existing.externalReference,
        feeRecordId: existingFee?.id,
        noPoachingUntil: existingReferral?.noPoachingUntil ?? undefined,
        alreadyProcessed: true,
      };
    }

    const [referral] = await tx.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, input.jobOrderReferralId));
    if (!referral) {
      throw new UserInputError(
        `job_order_referral ${input.jobOrderReferralId} が見つかりません / job_order_referral ${input.jobOrderReferralId} not found`,
        "jobOrderReferralIdを確認してください（job_order_referral.confirmで確定済みである必要があります） / Please verify jobOrderReferralId (must be finalized via job_order_referral.confirm)",
      );
    }

    const existingConditions = (referral.conditionsTyped as Record<string, unknown> | null) ?? {};

    if (input.outcomeInput.outcome === "hired") {
      const { hiredAt, indefiniteEmployment, employer, conversionTerms, fee } = input.outcomeInput;
      const noPoachingUntil = addYears(hiredAt, NO_POACHING_YEARS);

      await tx
        .update(jobOrderReferrals)
        .set({
          outcome: "hired",
          hiredAt,
          indefiniteEmployment,
          noPoachingUntil,
          phase: "F6",
          conditionsTyped: { ...existingConditions, ...conversionTerms },
        })
        .where(eq(jobOrderReferrals.id, input.jobOrderReferralId));

      const { id: payerSnapshotId } = await createPartySnapshot(tx, {
        tenantId: input.tenantId,
        partyType: "company",
        partyRefId: employer.companyId,
        snapshot: { ...employer },
        takenReason: "placement_confirm",
      });

      const feeRecordId = randomUUID();
      await tx.insert(feeRecords).values({
        id: feeRecordId,
        tenantId: input.tenantId,
        referralId: input.jobOrderReferralId,
        payerSnapshotId,
        feeType: fee.feeType,
        amountInclTax: fee.amountInclTax.toString(),
        calcBasisWage: fee.calcBasisWage?.toString(),
        calcBasisRate: fee.calcBasisRate?.toString(),
        collectedAt: fee.collectedAt,
      });

      await appendAuditEvent(tx, {
        tenantId: input.tenantId,
        aggregateType: "job_order_referral",
        aggregateId: input.jobOrderReferralId,
        aggregateVersion: 2,
        eventType: "placement.confirmed",
        afterHash: sha256Hex(canonicalJsonString({ jobOrderReferralId: input.jobOrderReferralId, outcome: "hired", hiredAt, feeRecordId })),
        principal: input.principal,
        requestId: input.requestId,
      });

      await enqueueOutboxEvent(tx, {
        tenantId: input.tenantId,
        aggregateType: "job_order_referral",
        aggregateId: input.jobOrderReferralId,
        eventType: "placement.confirmed",
        payload: { jobOrderReferralId: input.jobOrderReferralId, outcome: "hired", feeRecordId, reason: input.reason },
        idempotencyKey: input.idempotencyKey,
        externalReference: input.jobOrderReferralId,
      });

      return { jobOrderReferralId: input.jobOrderReferralId, feeRecordId, noPoachingUntil, alreadyProcessed: false };
    }

    const { nonHireRequestDetails } = input.outcomeInput;
    await tx
      .update(jobOrderReferrals)
      .set({
        outcome: "rejected",
        phase: "F6",
        conditionsTyped: { ...existingConditions, ...nonHireRequestDetails },
      })
      .where(eq(jobOrderReferrals.id, input.jobOrderReferralId));

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_order_referral",
      aggregateId: input.jobOrderReferralId,
      aggregateVersion: 2,
      eventType: "placement.confirmed",
      afterHash: sha256Hex(canonicalJsonString({ jobOrderReferralId: input.jobOrderReferralId, outcome: "rejected" })),
      principal: input.principal,
      requestId: input.requestId,
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_order_referral",
      aggregateId: input.jobOrderReferralId,
      eventType: "placement.confirmed",
      payload: { jobOrderReferralId: input.jobOrderReferralId, outcome: "rejected", reason: input.reason },
      idempotencyKey: input.idempotencyKey,
      externalReference: input.jobOrderReferralId,
    });

    return { jobOrderReferralId: input.jobOrderReferralId, alreadyProcessed: false };
  });
}

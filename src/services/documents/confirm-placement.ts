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
import { feeInvoiceDrafts, feeRecords, jobOrderReferrals, jobOrders, jobSeekers } from "../../db/schema/ledgers.js";
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

export type ConversionType = "t2p_conversion" | "win_transition" | "standard_placement_hire";
export type FeeStatus = "billable" | "pending_negotiation" | "on_hold";

export interface ConfirmPlacementHiredInput {
  outcome: "hired";
  hiredAt: string;
  indefiniteEmployment: boolean;
  employer: EmployerSnapshotInput;
  conversionType?: ConversionType;
  feeStatus?: FeeStatus;
  revenueCategory?: "pure_placement" | "dispatch_hire" | "win_management";
  expectedRevenueMin?: number;
  expectedRevenueMax?: number;
  // ⑦転換条件覚書の差込項目（conditionsTypedへマージ） / ⑦ conversion-memo fields (merged into conditionsTyped) / Field memo konversi ⑦ (digabung ke conditionsTyped)
  conversionTerms: Record<string, unknown>;
  fee?: FeeInput;
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

export interface AdHocFilingGuidance {
  sugukuruFiling: "3-1-2";
  receivingEmployerFiling: "3-1-1";
  deadlineDays: 14;
  eventDate: string;
  deadlineDate: string;
  notes: string[];
}

export interface FeeInvoiceDraft {
  title: string;
  referralId: string;
  feeRecordId?: string;
  amountInclTax?: number;
  feeType?: string;
  feeStatus: FeeStatus;
  revenueCategory?: string;
  payerCompanyId: string;
  payerName: string;
  hiredAt: string;
  bodyText: string;
}

export interface ConfirmPlacementResult {
  jobOrderReferralId: string;
  feeRecordId?: string;
  noPoachingUntil?: string;
  alreadyProcessed: boolean;
  // WF-25H 4点同時発火の成果物 / Artifacts of the WF-25H 4-point simultaneous fire / Artefak 4 titik simultan WF-25H
  feeInvoiceDraft?: FeeInvoiceDraft;
  adHocFilingGuidance?: AdHocFilingGuidance;
  jobOrderClosed?: boolean;
  selectionStage?: string;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildFeeInvoiceDraft(params: {
  referralId: string;
  feeRecordId?: string;
  fee?: FeeInput;
  feeStatus: FeeStatus;
  employer: EmployerSnapshotInput;
  hiredAt: string;
  conversionType: ConversionType;
  revenueCategory?: string;
}): FeeInvoiceDraft {
  const isPending = params.feeStatus === "pending_negotiation";
  const bodyText = [
    "紹介手数料請求ドラフト / Placement fee invoice draft / Draf tagihan fee penyaluran",
    `求人企業: ${params.employer.name}（${params.employer.companyId}）`,
    `成約日: ${params.hiredAt}`,
    `転換種別: ${params.conversionType}`,
    params.revenueCategory ? `成果区分: ${params.revenueCategory}` : undefined,
    `手数料ステータス: ${params.feeStatus}`,
    params.fee ? `手数料区分: ${params.fee.feeType}` : undefined,
    params.fee ? `請求額（税込）: ¥${params.fee.amountInclTax.toLocaleString("ja-JP")}` : undefined,
    params.fee?.calcBasisWage !== undefined ? `算定基礎賃金: ¥${params.fee.calcBasisWage.toLocaleString("ja-JP")}` : undefined,
    params.fee?.calcBasisRate !== undefined ? `算定基礎率: ${params.fee.calcBasisRate}` : undefined,
    `referral_id: ${params.referralId}`,
    params.feeRecordId ? `fee_record_id: ${params.feeRecordId}` : undefined,
    isPending ? "P5/WIN移行など手数料協議中のため、請求は保留。成約記帳と成約カウントのみ先行。" : undefined,
    "※求職者からの徴収は禁止（職安法32条の3）。就職成立後のみ企業へ請求。",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: "紹介手数料請求ドラフト",
    referralId: params.referralId,
    feeRecordId: params.feeRecordId,
    amountInclTax: params.fee?.amountInclTax,
    feeType: params.fee?.feeType,
    feeStatus: params.feeStatus,
    revenueCategory: params.revenueCategory,
    payerCompanyId: params.employer.companyId,
    payerName: params.employer.name,
    hiredAt: params.hiredAt,
    bodyText,
  };
}

function buildAdHocFilingGuidance(hiredAt: string, conversionType: ConversionType): AdHocFilingGuidance {
  const winNotes =
    conversionType === "win_transition"
      ? [
          "WIN移行: Driveの人材フォルダを🌠スグクル→🌞WIN国際へ移動し、支援記録は引き継ぐ",
          "WIN transition: move the Drive person folder from Sugukuru to WIN International and carry over support records",
          "Migrasi WIN: pindahkan folder Drive dari Sugukuru ke WIN International dan teruskan catatan dukungan",
        ]
      : [];
  return {
    sugukuruFiling: "3-1-2",
    receivingEmployerFiling: "3-1-1",
    deadlineDays: 14,
    eventDate: hiredAt,
    deadlineDate: addDays(hiredAt, 14),
    notes: [
      "スグクル側: 随時届出 3-1-2（所属機関の契約終了等）を事由発生日から14日以内に提出",
      "受入企業側: 随時届出 3-1-1（所属機関との契約締結等）を事由発生日から14日以内に提出",
      "所属機関変更を伴う場合は#20へWF-20A（申請準備開始）を起票",
      "Sugukuru: file ad-hoc 3-1-2 within 14 days of the event",
      "Receiving employer: file ad-hoc 3-1-1 within 14 days of the event",
      ...winNotes,
    ],
  };
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
      const { hiredAt, indefiniteEmployment, employer, conversionTerms } = input.outcomeInput;
      const conversionType =
        input.outcomeInput.conversionType ??
        (referral.placementPattern === "P3" ? "t2p_conversion" : referral.placementPattern === "P5" ? "win_transition" : "standard_placement_hire");
      const feeStatus = input.outcomeInput.feeStatus ?? "billable";
      const fee = input.outcomeInput.fee;
      const revenueCategory =
        input.outcomeInput.revenueCategory ??
        (conversionType === "win_transition" ? "win_management" : conversionType === "t2p_conversion" ? "pure_placement" : "pure_placement");
      const noPoachingUntil = addYears(hiredAt, NO_POACHING_YEARS);
      if (referral.placementPattern === "P3" && conversionType !== "t2p_conversion") {
        throw new UserInputError(
          "P3（紹介予定派遣）はconversionType=t2p_conversionで確定してください / P3 requires conversionType=t2p_conversion",
          "WF-25Hの転換種別を紹介予定派遣の成立にしてください / Use the T2P conversion type",
        );
      }
      if (referral.placementPattern === "P5" && conversionType !== "win_transition") {
        throw new UserInputError(
          "P5（WIN移行）はconversionType=win_transitionで確定してください / P5 requires conversionType=win_transition",
          "WF-25Hの転換種別をWIN移行にしてください / Use the WIN transition conversion type",
        );
      }
      if (conversionType === "win_transition" && referral.placementPattern !== "P5") {
        throw new UserInputError(
          "WIN移行はplacementPattern=P5の紹介行でのみ確定できます / WIN transition requires placementPattern=P5",
          "job_order_referral_confirmでplacementPattern=P5を明示してから成約してください / Re-create or correct the referral with placementPattern=P5",
        );
      }
      if (feeStatus === "billable" && !fee) {
        throw new UserInputError(
          "feeStatus=billableの場合、feeが必須です / fee is required when feeStatus=billable",
          "P5/WIN移行で請求保留にする場合はfeeStatus=pending_negotiationを指定してください / Use feeStatus=pending_negotiation for a held P5/WIN fee",
        );
      }
      const adHocFilingGuidance = buildAdHocFilingGuidance(hiredAt, conversionType);
      const referralBusinessFlag = conversionType === "win_transition" ? "win" : referral.businessFlag;

      // ① referral成約＋段階更新 / ① finalize referral + stage update
      await tx
        .update(jobOrderReferrals)
        .set({
          outcome: "hired",
          hiredAt,
          indefiniteEmployment,
          noPoachingUntil,
          phase: "F6",
          selectionStage: "placed",
          conversionType,
          businessFlag: referralBusinessFlag,
          revenueCategory,
          expectedRevenueMin: input.outcomeInput.expectedRevenueMin?.toString(),
          expectedRevenueMax: input.outcomeInput.expectedRevenueMax?.toString(),
          placedAt: hiredAt,
          offerAt: referral.offerAt ?? hiredAt,
          conditionsTyped: { ...existingConditions, ...conversionTerms, conversionType, feeStatus, adHocFilingGuidance },
          updatedAt: new Date(),
        })
        .where(eq(jobOrderReferrals.id, input.jobOrderReferralId));

      // ④ 求人クローズ＋求職者ステータス更新 / ④ close job order + mark seeker placed
      await tx
        .update(jobOrders)
        .set({ status: "filled", updatedAt: new Date() })
        .where(eq(jobOrders.id, referral.jobOrderId));
      await tx
        .update(jobSeekers)
        .set({ status: "placed", updatedAt: new Date() })
        .where(eq(jobSeekers.id, referral.jobSeekerId));

      const { id: payerSnapshotId } = await createPartySnapshot(tx, {
        tenantId: input.tenantId,
        partyType: "company",
        partyRefId: employer.companyId,
        snapshot: { ...employer },
        takenReason: "placement_confirm",
      });

      // ① 帳簿③記帳。P5など金額未定でもfeeStatus=pending_negotiationの保留行を残す / Post Ledger #3 even when pending / Catat Buku Besar #3 meski tertunda
      const feeRecordId = randomUUID();
      await tx.insert(feeRecords).values({
        id: feeRecordId,
        tenantId: input.tenantId,
        referralId: input.jobOrderReferralId,
        payerSnapshotId,
        feeType: fee?.feeType,
        feeStatus,
        amountInclTax: fee?.amountInclTax.toString(),
        calcBasisWage: fee?.calcBasisWage?.toString(),
        calcBasisRate: fee?.calcBasisRate?.toString(),
        collectedAt: fee?.collectedAt,
      });

      // ② 手数料請求ドラフト / ② fee invoice draft
      const feeInvoiceDraft = buildFeeInvoiceDraft({
        referralId: input.jobOrderReferralId,
        feeRecordId,
        fee,
        feeStatus,
        employer,
        hiredAt,
        conversionType,
        revenueCategory,
      });
      await tx.insert(feeInvoiceDrafts).values({
        id: randomUUID(),
        tenantId: input.tenantId,
        referralId: input.jobOrderReferralId,
        feeRecordId,
        payerCompanyId: employer.companyId,
        payerName: employer.name,
        amountInclTax: fee?.amountInclTax.toString(),
        feeStatus,
        title: feeInvoiceDraft.title,
        bodyText: feeInvoiceDraft.bodyText,
      });

      await appendAuditEvent(tx, {
        tenantId: input.tenantId,
        aggregateType: "job_order_referral",
        aggregateId: input.jobOrderReferralId,
        aggregateVersion: 2,
        eventType: "placement.confirmed",
        afterHash: sha256Hex(canonicalJsonString({ jobOrderReferralId: input.jobOrderReferralId, outcome: "hired", hiredAt, feeRecordId, conversionType, feeStatus })),
        principal: input.principal,
        requestId: input.requestId,
      });

      // ③ 随時届出案内＋④成約通知をoutboxへ（Slack投稿はhandler側） / ③ ad-hoc filing guidance + ④ placement notice to outbox
      await enqueueOutboxEvent(tx, {
        tenantId: input.tenantId,
        aggregateType: "job_order_referral",
        aggregateId: input.jobOrderReferralId,
        eventType: "placement.confirmed",
        payload: {
          jobOrderReferralId: input.jobOrderReferralId,
          outcome: "hired",
          feeRecordId,
          reason: input.reason,
          conversionType,
          feeStatus,
          feeInvoiceDraft,
          adHocFilingGuidance,
        },
        idempotencyKey: input.idempotencyKey,
        externalReference: input.jobOrderReferralId,
      });

      return {
        jobOrderReferralId: input.jobOrderReferralId,
        feeRecordId,
        noPoachingUntil,
        alreadyProcessed: false,
        feeInvoiceDraft,
        adHocFilingGuidance,
        jobOrderClosed: true,
        selectionStage: "placed",
      };
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

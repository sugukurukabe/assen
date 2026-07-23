/**
 * M2 Phase 2検証：紹介予定派遣（T2P）のF1〜F6縦切り統合テスト。
 * job_order.confirm（帳簿①・既存）→job_seeker.confirm（帳簿②・新規）→job_order_referral.confirm（紹介欄・新規）
 * →④⑤generate_draft→dispatch_assignment.confirm（t2pFlag=true・既存）→⑥generate_draft→
 * hiredルート（placement.confirm→⑦generate_draft＋fee_records検証）／
 * rejectedルート（placement.confirm→⑧generate_draft→placement.record_rejection_reason→⑨generate_draft）
 *
 * M2 Phase 2 verification: full F1-F6 vertical-slice integration test for T2P (job-order-to-placement dispatch).
 * job_order.confirm (Ledger #1, existing) -> job_seeker.confirm (Ledger #2, new) -> job_order_referral.confirm
 * (referral columns, new) -> ④/⑤ generate_draft -> dispatch_assignment.confirm (t2pFlag=true, existing) -> ⑥
 * generate_draft -> hired route (placement.confirm -> ⑦ generate_draft + fee_records verification) / rejected
 * route (placement.confirm -> ⑧ generate_draft -> placement.record_rejection_reason -> ⑨ generate_draft)
 *
 * Verifikasi M2 Phase 2: uji integrasi vertical-slice penuh F1-F6 untuk T2P (dispatch lowongan-ke-penempatan).
 * job_order.confirm (Buku Besar #1, sudah ada) -> job_seeker.confirm (Buku Besar #2, baru) ->
 * job_order_referral.confirm (kolom rujukan, baru) -> generate_draft ④/⑤ -> dispatch_assignment.confirm
 * (t2pFlag=true, sudah ada) -> generate_draft ⑥ -> rute diterima (placement.confirm -> generate_draft ⑦ +
 * verifikasi fee_records) / rute ditolak (placement.confirm -> generate_draft ⑧ ->
 * placement.record_rejection_reason -> generate_draft ⑨)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, getPool, type TenantScopedDb } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/audit.js";
import { documents } from "../src/db/schema/documents.js";
import { partySnapshots } from "../src/db/schema/party-snapshots.js";
import { dispatchAssignments, dispatchLedgerEntries, feeRecords, jobOrderReferrals, jobOrders, jobSeekers } from "../src/db/schema/ledgers.js";
import { sourceArtifacts } from "../src/db/schema/evidence.js";
import { analyzeJobOrder } from "../src/services/extraction/analyze-job-order.js";
import { confirmJobOrder } from "../src/services/documents/confirm-job-order.js";
import { confirmJobSeeker } from "../src/services/documents/confirm-job-seeker.js";
import { confirmJobOrderReferral } from "../src/services/documents/confirm-job-order-referral.js";
import { confirmDispatchAssignment } from "../src/services/documents/confirm-dispatch-assignment.js";
import { confirmPlacement } from "../src/services/documents/confirm-placement.js";
import { recordRejectionReason } from "../src/services/documents/record-rejection-reason.js";
import { generateDocumentDraft } from "../src/services/documents/generate-draft.js";
import { previewDocument } from "../src/services/documents/preview.js";
import { getDocTypeDefinition } from "../src/services/documents/doc-type-registry.js";
import type { AuthenticatedPrincipal } from "../src/lib/auth.js";
import { closePrivilegedDb, getPrivilegedDb } from "./helpers/privileged-db.js";

const requester: AuthenticatedPrincipal = {
  principalId: "m2-phase2-requester",
  role: "requester",
  authMethod: "local_fixed_token",
  tenantId: "m2-phase2-tenant",
};

// ④⑤書類の必須項目を満たす統合フィクスチャ（src/domain/t2p-job-order-notice.ts・t2p-consent-form.ts参照）
// Combined fixture satisfying the required items of ④/⑤ (see src/domain/t2p-job-order-notice.ts, t2p-consent-form.ts)
// Fixture gabungan yang memenuhi item wajib ④/⑤ (lihat src/domain/t2p-job-order-notice.ts, t2p-consent-form.ts)
const T2P_REFERRAL_CONDITIONS: Record<string, unknown> = {
  staffName: "スギヤント",
  clientName: "農業生産法人あずま園",
  clientAddress: "鹿児島県霧島市国分中央1-2-3",
  clientContact: "0995-00-0000",
  clientResponsiblePersonName: "東　次郎",
  dispatchPeriodStart: "2026-07-01",
  dispatchPeriodEnd: "2026-12-31",
  contractDate: "2026-06-20",
  contractNumber: "SGK-T2P-2026-0001",
  jobDuties: "施設園芸における農作業全般",
  jobDutiesChangeScope: "会社の定める業務の範囲内",
  workLocationT2p: "鹿児島県霧島市国分中央1-2-3",
  workLocationChangeScopeT2p: "会社の定める事業所の範囲内",
  contractPeriodTerms: "雇用期間は定めなし（無期雇用）。試用期間は設けない",
  probationPeriodTerms: "設けない（紹介予定派遣を経た直接雇用のため）",
  workHoursTerms: "8:00-17:00、休憩12:00-13:00、時間外労働は月20時間以内",
  daysOffTerms: "毎週日曜日・祝日、年次有給休暇は労基法通り",
  wageDetails: "月給25万円（固定残業代含む）、賞与年2回、昇給年1回",
  socialInsuranceEnrollment: "健康保険・厚生年金保険・雇用保険に加入",
  smokingPreventionMeasures: "屋内禁煙、屋外に喫煙所を設置",
  employmentCategoryT2p: "紹介予定派遣を経た直接雇用（正社員）",
  t2pConversionTiming: "派遣開始から6ヶ月以内",
  t2pConversionConditions: "正社員雇用、月給25万円、就業場所は同一",
  t2pNonHireReasonPolicy: "職業紹介を受けない場合・不採用の場合は書面により理由を明示する",
  dormitoryAndCommute: "社宅を用意、通勤手当は実費支給",
  otherRemarks: "特記事項なし",
  disclosureDate: "2026-06-20",
  disclosureMethod: "書面交付",
  staffContactPerson: "壁　晃弘",
  directEmploymentStartPlan: "派遣開始から6ヶ月以内に直接雇用へ切替予定",
  consentDate: "2026-06-20",
  seekerFullNameLatin: "Sugiyanto",
  explainedBy: "壁　晃弘",
  interpreterPresent: "なし",
  explanationLanguage: "インドネシア語（本人の理解を確認済み）",
};

// ⑥T2P個別契約書の必須項目を満たすdispatch_assignments.conditionsTyped（src/domain/t2p-individual-contract.ts参照）
// dispatch_assignments.conditionsTyped satisfying the required items of ⑥ (see src/domain/t2p-individual-contract.ts)
// dispatch_assignments.conditionsTyped yang memenuhi item wajib ⑥ (lihat src/domain/t2p-individual-contract.ts)
const T2P_DISPATCH_CONDITIONS: Record<string, unknown> = {
  contractNumber: "SGK-T2P-2026-0001",
  contractDate: "2026-06-20",
  clientName: "農業生産法人あずま園",
  jobDuties: "施設園芸における農作業全般",
  responsibilityLevel: "役職なし、権限の範囲なし",
  clientEstablishmentName: "農業生産法人あずま園",
  clientEstablishmentAddress: "鹿児島県霧島市国分中央1-2-3 TEL:0995-00-0000",
  workplace: "鹿児島県霧島市国分中央1-2-3",
  workLocationAddress: "鹿児島県霧島市国分中央1-2-3 TEL:0995-00-0000",
  orgUnit: "施設園芸部門",
  supervisorInfo: "所属：生産部　役職：圃場長　氏名：東　太郎　TEL:0995-00-0001",
  clientResponsiblePersonInfo: "所属：生産部　役職：派遣先責任者　氏名：東　次郎　TEL:0995-00-0001",
  agencyResponsiblePersonInfo: "氏名：壁　晃弘　TEL:03-0000-0000",
  dispatchPeriod: "2026-07-01から2026-12-31まで（通算6ヶ月以内）",
  workDays: "月曜日から土曜日まで",
  workHoursStart: "08:00",
  workHoursEnd: "17:00",
  breakTime: "12:00-13:00",
  headcount: "1名",
  feeAmount: "2,500円／時（消費税別）",
  agreementBasedWorkerLimitation: "対象労働者ではない（一般派遣）",
  clientAddress: "鹿児島県霧島市国分中央1-2-3",
  clientRepresentative: "代表取締役　東　三郎",
  referralFeeRate: "紹介手数料：直接雇用時の想定年収の30%",
};

// ⑦転換条件覚書の必須項目（placement.confirm hiredルートで使用。src/domain/t2p-conversion-memo.ts参照）
// Required items for ⑦ (used in the placement.confirm hired route; see src/domain/t2p-conversion-memo.ts)
// Item wajib untuk ⑦ (digunakan pada rute hired placement.confirm; lihat src/domain/t2p-conversion-memo.ts)
const CONVERSION_TERMS: Record<string, unknown> = {
  staffNationality: "インドネシア",
  staffResidenceStatusAndExpiry: "特定技能1号（在留期限2029-06-30）",
  clientRepresentative: "代表取締役　東　三郎",
  conversionDate: "2026-12-15",
  postConversionEmploymentType: "正社員",
  postConversionWage: "月給25万円",
  postConversionWorkLocation: "鹿児島県霧島市国分中央1-2-3",
  postConversionOtherTerms: "特記事項なし",
  referralFeeAmount: "300,000円（税別）",
  feePaymentDueDate: "2026-12-31",
  feePaymentMethod: "銀行振込",
  refundPolicy: "6ヶ月以内の自己都合退職の場合、50%を返金",
  replacementReferralClause: "退職の場合、無償で代替紹介を1回実施",
  visaProcedureFeeClause: "行政書士との直接契約により対応",
  memoDate: "2026-12-15",
};

// ⑧不採用理由の明示請求の必須項目（clientName等の共通項目はT2P_REFERRAL_CONDITIONSに含まれる。src/domain/t2p-non-hire-reason-request.ts参照）
// Required items for ⑧ (shared items like clientName come from T2P_REFERRAL_CONDITIONS; see src/domain/t2p-non-hire-reason-request.ts)
// Item wajib untuk ⑧ (item bersama seperti clientName berasal dari T2P_REFERRAL_CONDITIONS; lihat src/domain/t2p-non-hire-reason-request.ts)
const NON_HIRE_REQUEST_DETAILS: Record<string, unknown> = {
  documentNumber: "SGK-8-2026-0001",
  issueDate: "2026-08-01",
  staffManagementNumber: "STAFF-0001",
  nonHireCategory: "職業紹介を受けた派遣労働者を雇用しない場合",
  replyDueDate: "2026-08-15",
};

// ⑨不採用理由の書面明示のうちrejectionReason以外の追加項目（src/domain/t2p-non-hire-reason-notice.ts参照）
// Additional ⑨ items other than rejectionReason (see src/domain/t2p-non-hire-reason-notice.ts)
// Item tambahan ⑨ selain rejectionReason (lihat src/domain/t2p-non-hire-reason-notice.ts)
const NON_HIRE_NOTICE_ADDITIONAL_DETAILS: Record<string, unknown> = {
  noticeDate: "2026-08-20",
  noticeMethod: "書面交付",
};

let tenantId: string;
// RLSを実効性あるものとして検証するため、本番と同じacquireTenantScopedDbを使う（詳細はm1-gate.test.ts参照）
// Uses acquireTenantScopedDb, the same mechanism production uses, so RLS is genuinely exercised (see m1-gate.test.ts)
// Menggunakan acquireTenantScopedDb, mekanisme yang sama dengan produksi, sehingga RLS benar-benar diuji (lihat m1-gate.test.ts)
let tenantScoped: TenantScopedDb;
let db: TenantScopedDb["db"];

async function confirmSampleJobOrder(): Promise<{ jobOrderId: string }> {
  const analysis = await analyzeJobOrder(db, {
    tenantId,
    sourceText: "スギヤントを紹介予定派遣で受け入れたい農業生産法人あずま園からの求人。",
    sourceUri: `test://m2-phase2/${randomUUID()}`,
  });

  const { jobOrderId } = await confirmJobOrder(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "M2 Phase 2テスト（T2P求人受理）",
    sourceArtifactId: analysis.sourceArtifactId,
    employer: {
      companyId: randomUUID(),
      name: "農業生産法人あずま園",
      address: "鹿児島県霧島市国分中央1-2-3",
      representative: "代表取締役　東　三郎",
      contactPerson: "東　次郎",
    },
    fields: {
      acceptedAt: "2026-06-01",
      validUntil: "2026-11-30",
      headcount: 1,
      occupation: "農作業員（施設園芸）",
      workLocation: "鹿児島県霧島市",
      employmentPeriodType: "indefinite",
      wageUnit: "month",
      t2pFlag: true,
      refundSystem: true,
      source: "direct",
    },
  });
  return { jobOrderId };
}

async function confirmSampleJobSeeker(): Promise<{ jobSeekerId: string }> {
  const { jobSeekerId } = await confirmJobSeeker(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "M2 Phase 2テスト（求職者確定）",
    seeker: {
      staffId: randomUUID(),
      name: "スギヤント",
      address: "鹿児島県霧島市国分中央4-5-6",
      birthDate: "1998-04-01",
      nationality: "インドネシア",
    },
    piiConsent: {
      consentDate: "2026-06-15",
      scope: "T2P紹介業務のための氏名・住所・生年月日の取得・利用",
      recipients: "スグクル株式会社、紹介先の農業生産法人あずま園",
    },
    fields: {
      desiredOccupation: "農作業員（施設園芸）",
      acceptedAt: "2026-06-15",
      validUntil: "2026-12-15",
    },
  });
  return { jobSeekerId };
}

async function confirmSampleReferral(jobOrderId: string, jobSeekerId: string): Promise<{ jobOrderReferralId: string }> {
  const { jobOrderReferralId } = await confirmJobOrderReferral(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "M2 Phase 2テスト（紹介行確定）",
    jobOrderId,
    jobSeekerId,
    referredAt: "2026-06-20",
    type: "t2p",
    conditionsTyped: T2P_REFERRAL_CONDITIONS,
  });
  return { jobOrderReferralId };
}

async function confirmSampleDispatchAssignment(): Promise<{ dispatchAssignmentId: string }> {
  const result = await confirmDispatchAssignment(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "M2 Phase 2テスト（⑥T2P個別契約書用のdispatch_assignment確定）",
    worker: {
      staffId: randomUUID(),
      name: "スギヤント",
      address: "鹿児島県霧島市国分中央4-5-6",
      nationality: "インドネシア",
    },
    client: {
      companyId: randomUUID(),
      name: "農業生産法人あずま園",
      address: "鹿児島県霧島市国分中央1-2-3",
      representative: "代表取締役　東　三郎",
    },
    assignment: {
      t2pFlag: true,
      startDate: "2026-07-01",
      endDate: "2026-12-31",
      orgUnit: "施設園芸部門",
      conditionsTyped: T2P_DISPATCH_CONDITIONS,
    },
    ledgerEntry: {
      kyoteiTaisho: false,
      mukikoyo: false,
      workDetail: "施設園芸における農作業全般",
      socialInsurance: { health: true, pension: true, employment: true },
    },
  });
  return { dispatchAssignmentId: result.dispatchAssignmentId };
}

beforeAll(async () => {
  tenantId = randomUUID();
  tenantScoped = await acquireTenantScopedDb(tenantId);
  db = tenantScoped.db;
});

afterAll(async () => {
  await db.delete(documents).where(eq(documents.tenantId, tenantId));
  await db.delete(feeRecords).where(eq(feeRecords.tenantId, tenantId));
  await db.delete(jobOrderReferrals).where(eq(jobOrderReferrals.tenantId, tenantId));
  await db.delete(jobSeekers).where(eq(jobSeekers.tenantId, tenantId));
  await db.delete(dispatchLedgerEntries).where(eq(dispatchLedgerEntries.tenantId, tenantId));
  await db.delete(dispatchAssignments).where(eq(dispatchAssignments.tenantId, tenantId));
  await db.delete(jobOrders).where(eq(jobOrders.tenantId, tenantId));
  await db.delete(sourceArtifacts).where(eq(sourceArtifacts.tenantId, tenantId));
  await db.delete(partySnapshots).where(eq(partySnapshots.tenantId, tenantId));
  await getPrivilegedDb().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  tenantScoped.release();
  await getPool().end();
  await closePrivilegedDb();
});

describe("M2 Phase 2: F1〜F4（求人・求職者・紹介行・④⑤⑥書類） / F1-F4 (job order, job seeker, referral, documents ④/⑤/⑥)", () => {
  it("job_order.confirm→job_seeker.confirm→job_order_referral.confirmで紹介行が作成され、④⑤書類が完全な内容で生成できる / job_order.confirm -> job_seeker.confirm -> job_order_referral.confirm creates the referral row, and ④/⑤ generate with complete content", async () => {
    const { jobOrderId } = await confirmSampleJobOrder();
    const { jobSeekerId } = await confirmSampleJobSeeker();
    const { jobOrderReferralId } = await confirmSampleReferral(jobOrderId, jobSeekerId);

    const [referral] = await db.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, jobOrderReferralId));
    expect(referral?.jobOrderId).toBe(jobOrderId);
    expect(referral?.jobSeekerId).toBe(jobSeekerId);
    expect(referral?.type).toBe("t2p");
    expect(referral?.phase).toBe("F2");
    expect(referral?.outcome).toBe("pending");

    for (const docType of ["t2p_job_order_notice", "t2p_consent_form"] as const) {
      const preview = await previewDocument(db, { tenantId, docType, subjectId: jobOrderReferralId });
      expect(preview.findings).toEqual([]);
      expect(preview.renderedText).toContain(getDocTypeDefinition(docType)!.templateFileName.replace(".v1.txt", ".v1"));

      const draft = await generateDocumentDraft(db, {
        tenantId,
        docType,
        subjectId: jobOrderReferralId,
        principal: requester,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        reason: "M2 Phase 2テスト（④⑤生成）",
      });
      expect(draft.generatedSha256).toBeTruthy();

      const [documentRow] = await db.select().from(documents).where(eq(documents.id, draft.documentId));
      expect(documentRow?.docType).toBe(docType);
      expect(documentRow?.subjectType).toBe("job_order_referral");
      expect(documentRow?.contentStatus).toBe("draft");
    }
  });

  it("dispatch_assignment.confirm（t2pFlag=true）→⑥T2P個別契約書がpreview→generate_draftできる / dispatch_assignment.confirm (t2pFlag=true) -> ⑥ T2P individual contract previews and generates", async () => {
    const { dispatchAssignmentId } = await confirmSampleDispatchAssignment();

    const [assignment] = await db.select().from(dispatchAssignments).where(eq(dispatchAssignments.id, dispatchAssignmentId));
    expect(assignment?.t2pFlag).toBe(true);

    const preview = await previewDocument(db, { tenantId, docType: "t2p_individual_contract", subjectId: dispatchAssignmentId });
    expect(preview.findings).toEqual([]);

    const draft = await generateDocumentDraft(db, {
      tenantId,
      docType: "t2p_individual_contract",
      subjectId: dispatchAssignmentId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M2 Phase 2テスト（⑥生成）",
    });
    expect(draft.generatedSha256).toBeTruthy();
  });
});

describe("M2 Phase 2: F6A hiredルート（placement.confirm→帳簿③posting→⑦転換条件覚書） / F6A hired route (placement.confirm -> Ledger #3 posting -> ⑦ conversion memo)", () => {
  it("outcome=hiredで転職勧奨禁止期間が自動計算され、fee_records・party snapshotが作成され、⑦が生成できる / outcome=hired auto-computes the no-poaching period, creates fee_records/party snapshot, and ⑦ generates", async () => {
    const { jobOrderId } = await confirmSampleJobOrder();
    const { jobSeekerId } = await confirmSampleJobSeeker();
    const { jobOrderReferralId } = await confirmSampleReferral(jobOrderId, jobSeekerId);

    const placement = await confirmPlacement(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M2 Phase 2テスト（採用確定）",
      jobOrderReferralId,
      outcomeInput: {
        outcome: "hired",
        hiredAt: "2026-12-15",
        indefiniteEmployment: true,
        employer: {
          companyId: randomUUID(),
          name: "農業生産法人あずま園",
          address: "鹿児島県霧島市国分中央1-2-3",
          representative: "代表取締役　東　三郎",
          contactPerson: "東　次郎",
        },
        conversionTerms: CONVERSION_TERMS,
        fee: {
          feeType: "todokede",
          amountInclTax: 330000,
          calcBasisWage: 250000,
          calcBasisRate: 0.3,
          collectedAt: "2026-12-31",
        },
      },
    });

    expect(placement.alreadyProcessed).toBe(false);
    expect(placement.noPoachingUntil).toBe("2028-12-15");
    expect(placement.feeRecordId).toBeTruthy();

    const [referral] = await db.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, jobOrderReferralId));
    expect(referral?.outcome).toBe("hired");
    expect(referral?.hiredAt).toBe("2026-12-15");
    expect(referral?.indefiniteEmployment).toBe(true);
    expect(referral?.noPoachingUntil).toBe("2028-12-15");
    expect(referral?.phase).toBe("F6");

    const [feeRecord] = await db.select().from(feeRecords).where(eq(feeRecords.id, placement.feeRecordId!));
    expect(feeRecord?.referralId).toBe(jobOrderReferralId);
    expect(feeRecord?.feeType).toBe("todokede");
    expect(feeRecord?.amountInclTax).toBe("330000.00");

    const [payerSnapshot] = await db.select().from(partySnapshots).where(eq(partySnapshots.id, feeRecord!.payerSnapshotId));
    expect(payerSnapshot?.partyType).toBe("company");
    expect(payerSnapshot?.takenReason).toBe("placement_confirm");

    const preview = await previewDocument(db, { tenantId, docType: "t2p_conversion_memo", subjectId: jobOrderReferralId });
    expect(preview.findings).toEqual([]);

    const draft = await generateDocumentDraft(db, {
      tenantId,
      docType: "t2p_conversion_memo",
      subjectId: jobOrderReferralId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M2 Phase 2テスト（⑦生成）",
    });
    expect(draft.generatedSha256).toBeTruthy();
  });

  it("同一idempotencyKeyの再実行で同一のfeeRecordIdを返す（重複記帳を作らない） / retrying with the same idempotencyKey returns the same feeRecordId (no duplicate ledger postings)", async () => {
    const { jobOrderId } = await confirmSampleJobOrder();
    const { jobSeekerId } = await confirmSampleJobSeeker();
    const { jobOrderReferralId } = await confirmSampleReferral(jobOrderId, jobSeekerId);

    const idempotencyKey = randomUUID();
    const input = {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey,
      reason: "M2 Phase 2冪等性テスト",
      jobOrderReferralId,
      outcomeInput: {
        outcome: "hired" as const,
        hiredAt: "2026-12-15",
        indefiniteEmployment: true,
        employer: {
          companyId: randomUUID(),
          name: "農業生産法人あずま園",
          address: "鹿児島県霧島市国分中央1-2-3",
          representative: "代表取締役　東　三郎",
          contactPerson: "東　次郎",
        },
        conversionTerms: CONVERSION_TERMS,
        fee: { feeType: "todokede" as const, amountInclTax: 330000 },
      },
    };

    const first = await confirmPlacement(db, input);
    const retry = await confirmPlacement(db, { ...input, reason: "M2 Phase 2冪等性テスト（リトライ）" });

    expect(retry.feeRecordId).toBe(first.feeRecordId);
    expect(retry.alreadyProcessed).toBe(true);

    const rows = await db.select().from(feeRecords).where(eq(feeRecords.referralId, jobOrderReferralId));
    expect(rows).toHaveLength(1);
  });
});

describe("M2 Phase 2: F6B rejectedルート（placement.confirm→⑧→record_rejection_reason→⑨） / F6B rejected route (placement.confirm -> ⑧ -> record_rejection_reason -> ⑨)", () => {
  it("outcome=rejected→⑧生成→record_rejection_reason→⑨生成の一連が完全な内容で通る / the outcome=rejected -> ⑧ generation -> record_rejection_reason -> ⑨ generation chain completes with full content", async () => {
    const { jobOrderId } = await confirmSampleJobOrder();
    const { jobSeekerId } = await confirmSampleJobSeeker();
    const { jobOrderReferralId } = await confirmSampleReferral(jobOrderId, jobSeekerId);

    const placement = await confirmPlacement(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M2 Phase 2テスト（不採用確定）",
      jobOrderReferralId,
      outcomeInput: { outcome: "rejected", nonHireRequestDetails: NON_HIRE_REQUEST_DETAILS },
    });
    expect(placement.alreadyProcessed).toBe(false);

    const [referralAfterReject] = await db.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, jobOrderReferralId));
    expect(referralAfterReject?.outcome).toBe("rejected");
    expect(referralAfterReject?.phase).toBe("F6");

    const previewRequest = await previewDocument(db, { tenantId, docType: "t2p_non_hire_reason_request", subjectId: jobOrderReferralId });
    expect(previewRequest.findings).toEqual([]);

    const requestDraft = await generateDocumentDraft(db, {
      tenantId,
      docType: "t2p_non_hire_reason_request",
      subjectId: jobOrderReferralId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M2 Phase 2テスト（⑧生成）",
    });
    expect(requestDraft.generatedSha256).toBeTruthy();

    const recordResult = await recordRejectionReason(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M2 Phase 2テスト（不採用理由の記録）",
      jobOrderReferralId,
      rejectionReason: "求める栽培技術の実務経験が確認できなかったため",
      rejectionReasonReceivedAt: "2026-08-10",
      additionalDetails: NON_HIRE_NOTICE_ADDITIONAL_DETAILS,
    });
    expect(recordResult.alreadyProcessed).toBe(false);

    const [referralAfterReason] = await db.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, jobOrderReferralId));
    expect(referralAfterReason?.rejectionReason).toBe("求める栽培技術の実務経験が確認できなかったため");
    expect(referralAfterReason?.rejectionReasonReceivedAt).toBe("2026-08-10");

    const previewNotice = await previewDocument(db, { tenantId, docType: "t2p_non_hire_reason_notice", subjectId: jobOrderReferralId });
    expect(previewNotice.findings).toEqual([]);
    expect(previewNotice.renderedText).toContain("求める栽培技術の実務経験が確認できなかったため");

    const noticeDraft = await generateDocumentDraft(db, {
      tenantId,
      docType: "t2p_non_hire_reason_notice",
      subjectId: jobOrderReferralId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M2 Phase 2テスト（⑨生成）",
    });
    expect(noticeDraft.generatedSha256).toBeTruthy();
  });

  it("outcome=rejectedで確定していない紹介行にrecord_rejection_reasonを呼ぶとUserInputErrorになる / calling record_rejection_reason on a referral not confirmed as outcome=rejected throws UserInputError", async () => {
    const { jobOrderId } = await confirmSampleJobOrder();
    const { jobSeekerId } = await confirmSampleJobSeeker();
    const { jobOrderReferralId } = await confirmSampleReferral(jobOrderId, jobSeekerId);

    await expect(
      recordRejectionReason(db, {
        tenantId,
        principal: requester,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        reason: "異常系テスト",
        jobOrderReferralId,
        rejectionReason: "テスト理由",
        rejectionReasonReceivedAt: "2026-08-10",
      }),
    ).rejects.toThrow(/outcome=rejectedで確定していません/);
  });
});

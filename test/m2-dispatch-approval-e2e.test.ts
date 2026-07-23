/**
 * 自社MVPゲート検証（docs/registry-readiness-checklist.md G節）：
 * M1ゲート（test/m1-gate.test.ts）はlabor_conditions_noticeのみを対象に承認〜交付の縦切りを検証していた。
 * 本テストは同じ縦切り（document.generate_draft→document.request_approval→document.approve→
 * document.attach_executed_copy→document.record_delivery）が、M2で追加された派遣3点書類（A2/A3/A10）と
 * T2P書類（④求人条件明示書）でも機能することを検証する。approve/attach_executed_copy/record_deliveryは
 * documents テーブルに対して docType に依存せず汎用的に動作する設計のため、このテストは
 * 「新docTypeのdocumentが同じ汎用パイプラインを通り切れるか」を確認する
 *
 * Internal-MVP gate verification (docs/registry-readiness-checklist.md section G):
 * test/m1-gate.test.ts only exercised the approve -> delivery vertical slice for labor_conditions_notice.
 * This test extends the same slice (document.generate_draft -> document.request_approval -> document.approve ->
 * document.attach_executed_copy -> document.record_delivery) to the dispatch 3-document set (A2/A3/A10) and one
 * T2P document (④ job-order conditions notice) added in M2. Since approve/attach_executed_copy/record_delivery are
 * docType-agnostic over the documents table by design, this test confirms new docTypes' documents can traverse the
 * same generic pipeline end to end
 *
 * Verifikasi gate MVP internal (docs/registry-readiness-checklist.md bagian G):
 * test/m1-gate.test.ts hanya menguji vertical slice approve -> delivery untuk labor_conditions_notice. Test ini
 * memperluas slice yang sama ke set 3-dokumen dispatch (A2/A3/A10) dan satu dokumen T2P (④ pemberitahuan ketentuan
 * lowongan) yang ditambahkan di M2.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, getPool, type TenantScopedDb } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/audit.js";
import { approvalRequests, documents } from "../src/db/schema/documents.js";
import { partySnapshots } from "../src/db/schema/party-snapshots.js";
import { dispatchAssignments, dispatchLedgerEntries, jobOrderReferrals, jobOrders, jobSeekers } from "../src/db/schema/ledgers.js";
import { sourceArtifacts } from "../src/db/schema/evidence.js";
import { confirmDispatchAssignment } from "../src/services/documents/confirm-dispatch-assignment.js";
import { analyzeJobOrder } from "../src/services/extraction/analyze-job-order.js";
import { confirmJobOrder } from "../src/services/documents/confirm-job-order.js";
import { confirmJobSeeker } from "../src/services/documents/confirm-job-seeker.js";
import { confirmJobOrderReferral } from "../src/services/documents/confirm-job-order-referral.js";
import { generateDocumentDraft } from "../src/services/documents/generate-draft.js";
import { requestDocumentApproval } from "../src/services/documents/request-approval.js";
import { approveDocument } from "../src/services/documents/approve.js";
import { attachExecutedCopy } from "../src/services/documents/attach-executed-copy.js";
import { recordDelivery } from "../src/services/documents/record-delivery.js";
import { verifyChain } from "../src/audit/hash-chain.js";
import type { AuthenticatedPrincipal } from "../src/lib/auth.js";
import { closePrivilegedDb, getPrivilegedDb } from "./helpers/privileged-db.js";

const requester: AuthenticatedPrincipal = {
  principalId: "m2-approval-e2e-requester",
  role: "requester",
  authMethod: "local_fixed_token",
  tenantId: "m2-approval-e2e-tenant",
};

const approver: AuthenticatedPrincipal = {
  principalId: "m2-approval-e2e-approver",
  role: "approver",
  authMethod: "local_fixed_token",
  tenantId: "m2-approval-e2e-tenant",
};

// 派遣3点書類（A2/A3/A10）＋labor_conditions_noticeの必須項目を満たす統合フィクスチャ（test/m2-dispatch-documents.test.tsのFULL_CONDITIONSと同内容）
// Combined fixture satisfying the required items of the dispatch 3-document set + labor_conditions_notice (same content as FULL_CONDITIONS in test/m2-dispatch-documents.test.ts)
// Fixture gabungan yang memenuhi item wajib set 3-dokumen dispatch + labor_conditions_notice (sama dengan FULL_CONDITIONS di test/m2-dispatch-documents.test.ts)
const FULL_DISPATCH_CONDITIONS: Record<string, unknown> = {
  contractPeriod: "2026-07-01から2027-06-30まで",
  workplace: "鹿児島県霧島市国分中央1-2-3",
  jobDuties: "施設園芸における農作業全般",
  workHoursStart: "08:00",
  workHoursEnd: "17:00",
  breakTime: "12:00-13:00",
  daysOff: "毎週日曜日・祝日",
  leaveEntitlement: "年次有給休暇（労基法通り）",
  wageDeterminationMethod: "時給制、毎月末日締め翌月10日払い",
  wagePayDate: "毎月10日",
  resignationTerms: "自己都合退職は30日前申告。解雇事由は就業規則第10条による",
  clientEstablishmentName: "農業生産法人あずま園",
  dispatchPeriod: "2026-07-01から2027-06-30まで",
  orgUnit: "施設園芸部門",
  contractNumber: "SGK-A2-2026-0001",
  contractDate: "2026-06-20",
  clientName: "農業生産法人あずま園",
  responsibilityLevel: "役職なし、権限の範囲なし",
  clientEstablishmentAddress: "鹿児島県霧島市国分中央1-2-3 TEL:0995-00-0000",
  workLocationAddress: "鹿児島県霧島市国分中央1-2-3 TEL:0995-00-0000",
  supervisorInfo: "所属：生産部　役職：圃場長　氏名：東　太郎　TEL:0995-00-0001",
  clientResponsiblePersonInfo: "所属：生産部　役職：派遣先責任者　氏名：東　次郎　TEL:0995-00-0001",
  agencyResponsiblePersonInfo: "氏名：壁　晃弘　TEL:03-0000-0000",
  teishokubiDisplay: "2029-06-30",
  workDays: "月曜日から土曜日まで",
  headcount: "1名",
  feeAmount: "2,500円／時（消費税別）",
  agreementBasedWorkerLimitation: "対象労働者ではない（一般派遣）",
  clientAddress: "鹿児島県霧島市国分中央1-2-3",
  clientRepresentative: "代表取締役　東　三郎",
  workLocationInitial: "鹿児島県霧島市国分中央1-2-3（農業生産法人あずま園 圃場）",
  safetyAndHealth: "派遣就業中の安全衛生は派遣先の規程を適用し、その他は派遣元の規程を適用する",
  complaintHandling: "派遣元責任者・派遣先責任者を窓口とし、相互に連絡調整のうえ解決する",
  contractTerminationMeasures: "新たな就業機会の確保に努め、確保できない場合は休業手当相当額以上を賠償する",
  disputePreventionMeasures: "派遣先が雇用する場合は派遣元の有料職業紹介事業の許可を経由して行う",
  notificationNumber: "SGK-A10-2026-0001",
  notificationDate: "2026-06-25",
  agencyResponsiblePersonName: "壁　晃弘",
  staffName: "スギヤント",
  staffGender: "男性",
  staffBirthDate: "1998-04-01",
  staffNationality: "インドネシア",
  employmentCategory: "有期雇用派遣労働者",
  healthInsuranceStatus: "有",
  pensionInsuranceStatus: "有",
  employmentInsuranceStatus: "有",
};

// T2P④求人条件明示書の必須項目を満たすjob_order_referrals.conditionsTyped（test/m2-phase2-t2p-documents.test.tsのT2P_REFERRAL_CONDITIONSと同内容）
// job_order_referrals.conditionsTyped satisfying the required items of T2P ④ (same content as T2P_REFERRAL_CONDITIONS in test/m2-phase2-t2p-documents.test.ts)
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
};

let tenantId: string;
// RLSを実効性あるものとして検証するため、本番と同じacquireTenantScopedDbを使う（詳細はm1-gate.test.ts参照）
// Uses acquireTenantScopedDb, the same mechanism production uses, so RLS is genuinely exercised (see m1-gate.test.ts)
let tenantScoped: TenantScopedDb;
let db: TenantScopedDb["db"];

async function confirmSampleDispatchAssignment(): Promise<string> {
  const { dispatchAssignmentId } = await confirmDispatchAssignment(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "自社MVP承認E2Eテスト",
    worker: { staffId: randomUUID(), name: "スギヤント", address: "鹿児島県霧島市国分中央4-5-6", nationality: "インドネシア" },
    client: {
      companyId: randomUUID(),
      name: "農業生産法人あずま園",
      address: "鹿児島県霧島市国分中央1-2-3",
      representative: "代表取締役　東　三郎",
    },
    assignment: {
      t2pFlag: false,
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      orgUnit: "施設園芸部門",
      teishokubi: "2029-06-30",
      conditionsTyped: FULL_DISPATCH_CONDITIONS,
    },
    ledgerEntry: {
      kyoteiTaisho: false,
      mukikoyo: false,
      workDetail: "施設園芸における農作業全般",
      socialInsurance: { health: true, pension: true, employment: true },
    },
  });
  return dispatchAssignmentId;
}

async function confirmSampleJobOrderReferral(): Promise<string> {
  const analysis = await analyzeJobOrder(db, {
    tenantId,
    sourceText: "スギヤントを紹介予定派遣で受け入れたい農業生産法人あずま園からの求人。",
    sourceUri: `test://m2-approval-e2e/${randomUUID()}`,
  });
  const { jobOrderId } = await confirmJobOrder(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "自社MVP承認E2Eテスト（T2P求人受理）",
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

  const { jobSeekerId } = await confirmJobSeeker(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "自社MVP承認E2Eテスト（求職者確定）",
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
    fields: { desiredOccupation: "農作業員（施設園芸）", acceptedAt: "2026-06-15", validUntil: "2026-12-15" },
  });

  const { jobOrderReferralId } = await confirmJobOrderReferral(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "自社MVP承認E2Eテスト（紹介行確定）",
    jobOrderId,
    jobSeekerId,
    referredAt: "2026-06-20",
    type: "t2p",
    conditionsTyped: T2P_REFERRAL_CONDITIONS,
  });
  return jobOrderReferralId;
}

/**
 * generate_draft→request_approval→approve→attach_executed_copy→record_deliveredの縦切りを1本通し、
 * 最終状態とaudit_eventsの完全性（M1ゲートと同じ7イベント）を検証する共通ヘルパー
 * Shared helper that drives the generate_draft -> request_approval -> approve -> attach_executed_copy ->
 * record_delivered slice once and verifies the final state and audit_events completeness (the same 7 events as
 * the M1 gate)
 */
async function runApprovalToDeliverySlice(docType: string, subjectId: string): Promise<void> {
  const draft = await generateDocumentDraft(db, {
    tenantId,
    docType,
    subjectId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "自社MVP承認E2Eテスト",
  });
  expect(draft.generatedSha256).toBeTruthy();

  const approvalRequest = await requestDocumentApproval(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    documentId: draft.documentId,
    requiredRole: "approver",
  });
  expect(approvalRequest.nonce).toMatch(/^[0-9a-f-]{36}$/);
  expect(approvalRequest.expiresAt.getTime()).toBeGreaterThan(Date.now());

  // 職務分離：起票者（requester）と異なるprincipal（approver）が承認する / Segregation of duties: approval is done by a different principal (approver) than the requester / Pemisahan tugas: persetujuan dilakukan oleh principal (approver) yang berbeda dari requester
  const approval = await approveDocument(db, {
    tenantId,
    principal: approver,
    requestId: randomUUID(),
    approvalRequestId: approvalRequest.approvalRequestId,
    decision: "approved",
    decisionReason: "自社MVP承認E2Eテストでの内容確認済み",
  });
  expect(approval.contentStatus).toBe("approved");

  const executed = await attachExecutedCopy(db, {
    tenantId,
    principal: approver,
    requestId: randomUUID(),
    documentId: draft.documentId,
    executedBytesBase64: Buffer.from("signed-pdf-bytes-stand-in").toString("base64"),
    contentType: "application/pdf",
  });
  expect(executed.executedSha256).toBeTruthy();

  for (const deliveryStatus of ["queued", "sent", "delivered"] as const) {
    await recordDelivery(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      documentId: draft.documentId,
      deliveryStatus,
      method: "email",
      electronicConsent: true,
    });
  }

  const [finalDocument] = await db.select().from(documents).where(eq(documents.id, draft.documentId));
  expect(finalDocument?.docType).toBe(docType);
  expect(finalDocument?.contentStatus).toBe("approved");
  expect(finalDocument?.executionStatus).toBe("executed");
  expect(finalDocument?.deliveryStatus).toBe("delivered");

  const trail = await db.select().from(auditEvents).where(eq(auditEvents.aggregateId, draft.documentId));
  const eventTypes = trail.map((event) => event.eventType).sort();
  expect(eventTypes).toEqual(
    [
      "document.draft_generated",
      "document.approval_requested",
      "document.approved",
      "document.executed_copy_attached",
      "document.delivery_queued",
      "document.delivery_sent",
      "document.delivery_delivered",
    ].sort(),
  );
  for (const event of trail) {
    expect(event.actorPrincipalId).toBeTruthy();
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.afterHash).toBeTruthy();
    expect(event.eventHash).toBeTruthy();
  }

  const problems = await verifyChain(db, tenantId);
  expect(problems).toEqual([]);
}

beforeAll(async () => {
  tenantId = randomUUID();
  tenantScoped = await acquireTenantScopedDb(tenantId);
  db = tenantScoped.db;
});

afterAll(async () => {
  await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId));
  await db.delete(documents).where(eq(documents.tenantId, tenantId));
  await db.delete(dispatchLedgerEntries).where(eq(dispatchLedgerEntries.tenantId, tenantId));
  await db.delete(dispatchAssignments).where(eq(dispatchAssignments.tenantId, tenantId));
  await db.delete(jobOrderReferrals).where(eq(jobOrderReferrals.tenantId, tenantId));
  await db.delete(jobSeekers).where(eq(jobSeekers.tenantId, tenantId));
  await db.delete(jobOrders).where(eq(jobOrders.tenantId, tenantId));
  await db.delete(sourceArtifacts).where(eq(sourceArtifacts.tenantId, tenantId));
  await db.delete(partySnapshots).where(eq(partySnapshots.tenantId, tenantId));
  // audit_eventsはruntimeロールからDELETEを剥奪しているため、後始末はsuperuser相当の接続で行う / audit_events has DELETE revoked from the runtime role, so cleanup uses the superuser-equivalent connection
  await getPrivilegedDb().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  tenantScoped.release();
  await getPool().end();
  await closePrivilegedDb();
});

describe("自社MVPゲート: 派遣3点書類（A2/A3/A10）の承認〜交付E2E / Internal-MVP gate: A2/A3/A10 approval-to-delivery E2E", () => {
  it.each(["dispatch_individual_contract", "dispatch_working_conditions_notice", "dispatch_worker_notice"] as const)(
    "docType=%s: draft→承認依頼→承認→署名済み添付→交付が完走し、audit_eventsが完全に追跡可能 / docType=%s: draft -> approval request -> approve -> executed-copy attach -> delivery completes with a fully traceable audit trail",
    async (docType) => {
      const dispatchAssignmentId = await confirmSampleDispatchAssignment();
      await runApprovalToDeliverySlice(docType, dispatchAssignmentId);
    },
  );
});

describe("自社MVPゲート: T2P④求人条件明示書の承認〜交付E2E / Internal-MVP gate: T2P ④ job-order-conditions-notice approval-to-delivery E2E", () => {
  it("job_order_referral subjectのdocumentもdraft→承認依頼→承認→署名済み添付→交付が完走する / a document whose subject is job_order_referral also completes draft -> approval -> executed-copy attach -> delivery", async () => {
    const jobOrderReferralId = await confirmSampleJobOrderReferral();
    await runApprovalToDeliverySlice("t2p_job_order_notice", jobOrderReferralId);
  });
});

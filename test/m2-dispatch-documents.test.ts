/**
 * M2 Phase 1検証：dispatch_assignment.confirm（A4派遣元管理台帳の自動記帳を含む）と、
 * 派遣3点書類（A2個別契約書／A3就業条件明示書／A10派遣先通知）＋既存labor_conditions_noticeの
 * document.generate_draft／document.preview／compliance.evaluateがdocType単位で正しく動作することを検証する
 *
 * M2 Phase 1 verification: dispatch_assignment.confirm (including automatic posting to the A4
 * dispatching-agency ledger) and, per docType, correct behavior of document.generate_draft /
 * document.preview / compliance.evaluate for the dispatch "3 documents" (A2 individual contract /
 * A3 working-conditions notice / A10 notification of dispatched worker) plus the existing labor_conditions_notice
 *
 * Verifikasi M2 Phase 1: dispatch_assignment.confirm (termasuk posting otomatis ke buku besar agen
 * dispatch A4) dan, per docType, perilaku benar dari document.generate_draft / document.preview /
 * compliance.evaluate untuk "3 dokumen" dispatch (A2 kontrak individual / A3 pemberitahuan ketentuan
 * kerja / A10 pemberitahuan pekerja dispatch) ditambah labor_conditions_notice yang sudah ada
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, getPool, type TenantScopedDb } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/audit.js";
import { documents } from "../src/db/schema/documents.js";
import { partySnapshots } from "../src/db/schema/party-snapshots.js";
import { dispatchAssignments, dispatchLedgerEntries } from "../src/db/schema/ledgers.js";
import { confirmDispatchAssignment } from "../src/services/documents/confirm-dispatch-assignment.js";
import { generateDocumentDraft } from "../src/services/documents/generate-draft.js";
import { previewDocument } from "../src/services/documents/preview.js";
import { evaluateSubjectCompliance } from "../src/services/rules/evaluate-subject.js";
import { getDocTypeDefinition, SUPPORTED_DOC_TYPES } from "../src/services/documents/doc-type-registry.js";
import type { AuthenticatedPrincipal } from "../src/lib/auth.js";
import { closePrivilegedDb, getPrivilegedDb } from "./helpers/privileged-db.js";

const requester: AuthenticatedPrincipal = {
  principalId: "m2-dispatch-requester",
  role: "requester",
  authMethod: "local_fixed_token",
  tenantId: "m2-dispatch-tenant",
};

// labor_conditions_notice・A2・A3・A10の必須項目を満たす統合フィクスチャ（src/domain/dispatch-conditions.ts参照）
// Combined fixture satisfying the required items of labor_conditions_notice, A2, A3, and A10 (see src/domain/dispatch-conditions.ts)
// Fixture gabungan yang memenuhi item wajib labor_conditions_notice, A2, A3, dan A10 (lihat src/domain/dispatch-conditions.ts)
const FULL_CONDITIONS: Record<string, unknown> = {
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

let tenantId: string;
// RLSを実効性あるものとして検証するため、本番と同じacquireTenantScopedDbを使う（詳細はm1-gate.test.ts参照）
// Uses acquireTenantScopedDb, the same mechanism production uses, so RLS is genuinely exercised (see m1-gate.test.ts)
// Menggunakan acquireTenantScopedDb, mekanisme yang sama dengan produksi, sehingga RLS benar-benar diuji (lihat m1-gate.test.ts)
let tenantScoped: TenantScopedDb;
let db: TenantScopedDb["db"];

async function confirmSampleAssignment(): Promise<{ dispatchAssignmentId: string; dispatchLedgerEntryId: string }> {
  const result = await confirmDispatchAssignment(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "M2 Phase 1テスト",
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
      t2pFlag: false,
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      orgUnit: "施設園芸部門",
      teishokubi: "2029-06-30",
      conditionsTyped: FULL_CONDITIONS,
    },
    ledgerEntry: {
      kyoteiTaisho: false,
      mukikoyo: false,
      workDetail: "施設園芸における農作業全般",
      socialInsurance: { health: true, pension: true, employment: true },
    },
  });
  return result;
}

beforeAll(async () => {
  tenantId = randomUUID();
  tenantScoped = await acquireTenantScopedDb(tenantId);
  db = tenantScoped.db;
});

afterAll(async () => {
  await db.delete(documents).where(eq(documents.tenantId, tenantId));
  await db.delete(dispatchLedgerEntries).where(eq(dispatchLedgerEntries.tenantId, tenantId));
  await db.delete(dispatchAssignments).where(eq(dispatchAssignments.tenantId, tenantId));
  await db.delete(partySnapshots).where(eq(partySnapshots.tenantId, tenantId));
  await getPrivilegedDb().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  tenantScoped.release();
  await getPool().end();
  await closePrivilegedDb();
});

describe("M2 Phase 1: dispatch_assignment.confirm・A4台帳自動記帳 / dispatch_assignment.confirm and automatic A4 ledger posting", () => {
  it("worker/clientスナップショット・dispatch_assignments・dispatch_ledger_entriesが同時に作成される / worker/client snapshots, dispatch_assignments, and dispatch_ledger_entries are created together", async () => {
    const { dispatchAssignmentId, dispatchLedgerEntryId } = await confirmSampleAssignment();

    const [assignment] = await db.select().from(dispatchAssignments).where(eq(dispatchAssignments.id, dispatchAssignmentId));
    expect(assignment?.startDate).toBe("2026-07-01");

    const [ledgerEntry] = await db.select().from(dispatchLedgerEntries).where(eq(dispatchLedgerEntries.id, dispatchLedgerEntryId));
    expect(ledgerEntry?.dispatchAssignmentId).toBe(dispatchAssignmentId);
    expect(ledgerEntry?.workDetail).toBe("施設園芸における農作業全般");

    const [workerSnapshot] = await db.select().from(partySnapshots).where(eq(partySnapshots.id, ledgerEntry!.workerSnapshotId));
    expect(workerSnapshot?.partyType).toBe("worker");
    const [clientSnapshot] = await db.select().from(partySnapshots).where(eq(partySnapshots.id, ledgerEntry!.clientSnapshotId));
    expect(clientSnapshot?.partyType).toBe("company");

    const trail = await db.select().from(auditEvents).where(eq(auditEvents.aggregateId, dispatchAssignmentId));
    expect(trail.map((event) => event.eventType)).toEqual(["dispatch_assignment.confirmed"]);
  });

  it("同一idempotencyKeyの再実行で同一のdispatchAssignmentId/dispatchLedgerEntryIdを返す（重複記帳を作らない） / retrying with the same idempotencyKey returns the same ids (no duplicate ledger postings)", async () => {
    const idempotencyKey = randomUUID();
    const input = {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey,
      reason: "冪等性テスト",
      worker: { staffId: randomUUID(), name: "テスト太郎", address: "鹿児島県霧島市" },
      client: { companyId: randomUUID(), name: "テスト農園", address: "鹿児島県霧島市" },
      assignment: {
        t2pFlag: false,
        startDate: "2026-07-01",
        conditionsTyped: FULL_CONDITIONS,
      },
      ledgerEntry: {
        kyoteiTaisho: false,
        mukikoyo: false,
        workDetail: "テスト業務",
        socialInsurance: { health: true },
      },
    };

    const first = await confirmDispatchAssignment(db, input);
    const retry = await confirmDispatchAssignment(db, { ...input, reason: "冪等性テスト（リトライ）" });

    expect(retry.dispatchAssignmentId).toBe(first.dispatchAssignmentId);
    expect(retry.dispatchLedgerEntryId).toBe(first.dispatchLedgerEntryId);
    expect(retry.alreadyProcessed).toBe(true);

    const rows = await db.select().from(dispatchAssignments).where(eq(dispatchAssignments.staffId, input.worker.staffId));
    expect(rows).toHaveLength(1);
  });
});

describe("M2 Phase 1: 派遣3点書類（A2/A3/A10）＋labor_conditions_noticeのdocType別生成 / dispatch 3-document set (A2/A3/A10) plus labor_conditions_notice, generated per docType", () => {
  it("SUPPORTED_DOC_TYPESに4種類のdocTypeが登録されている / SUPPORTED_DOC_TYPES registers all four docTypes", () => {
    expect([...SUPPORTED_DOC_TYPES].sort()).toEqual(
      ["dispatch_individual_contract", "dispatch_worker_notice", "dispatch_working_conditions_notice", "labor_conditions_notice"].sort(),
    );
  });

  it.each(SUPPORTED_DOC_TYPES)(
    "docType=%s: preview→generate_draftで完全な内容ならfindingsが空でdraftを生成できる / preview -> generate_draft produces an empty-findings draft when content is complete",
    async (docType) => {
      const { dispatchAssignmentId } = await confirmSampleAssignment();

      const preview = await previewDocument(db, { tenantId, docType, dispatchAssignmentId });
      expect(preview.findings).toEqual([]);
      expect(preview.renderedText).toContain(getDocTypeDefinition(docType)!.templateFileName.replace(".v1.txt", ".v1"));

      const draft = await generateDocumentDraft(db, {
        tenantId,
        docType,
        dispatchAssignmentId,
        principal: requester,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        reason: "M2 Phase 1テスト",
      });
      expect(draft.generatedSha256).toBeTruthy();

      const [documentRow] = await db.select().from(documents).where(eq(documents.id, draft.documentId));
      expect(documentRow?.docType).toBe(docType);
      expect(documentRow?.subjectType).toBe("dispatch_assignment");
      expect(documentRow?.contentStatus).toBe("draft");
    },
  );

  it("A2（dispatch_individual_contract）はresponsibilityLevelが欠落するとincomplete findingを返す / A2 (dispatch_individual_contract) returns an incomplete finding when responsibilityLevel is missing", async () => {
    const incompleteConditions: Record<string, unknown> = { ...FULL_CONDITIONS };
    delete incompleteConditions.responsibilityLevel;

    const { dispatchAssignmentId } = await confirmDispatchAssignment(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "欠落項目テスト",
      worker: { staffId: randomUUID(), name: "テスト花子", address: "鹿児島県霧島市" },
      client: { companyId: randomUUID(), name: "テスト農園2", address: "鹿児島県霧島市" },
      assignment: { t2pFlag: false, startDate: "2026-07-01", conditionsTyped: incompleteConditions },
      ledgerEntry: { kyoteiTaisho: false, mukikoyo: false, workDetail: "テスト業務", socialInsurance: { health: true } },
    });

    const [assignment] = await db.select().from(dispatchAssignments).where(eq(dispatchAssignments.id, dispatchAssignmentId));
    const findings = await evaluateSubjectCompliance(db, {
      tenantId,
      subjectType: "dispatch_assignment",
      subjectId: dispatchAssignmentId,
      mappingFileName: getDocTypeDefinition("dispatch_individual_contract")!.mappingFileName,
      row: assignment!,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.result).toBe("incomplete");
    expect(findings[0]?.missingFields).toContain("conditionsTyped.responsibilityLevel");
  });

  it("未対応のdocTypeを指定するとUserInputErrorになる / an unsupported docType throws UserInputError", async () => {
    const { dispatchAssignmentId } = await confirmSampleAssignment();
    await expect(
      generateDocumentDraft(db, {
        tenantId,
        docType: "no_such_doc_type",
        dispatchAssignmentId,
        principal: requester,
        requestId: randomUUID(),
        idempotencyKey: randomUUID(),
        reason: "異常系テスト",
      }),
    ).rejects.toThrow(/未対応のdocType/);
  });
});

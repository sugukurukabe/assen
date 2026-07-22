/**
 * M1ゲート検証（§11 Done条件）：
 *   「一案件の全操作がactor・時刻・版・ハッシュ付きで追跡可能。approval_requestsのnonce/hash/期限が機能」
 * 労働条件通知書1本の縦切り（draft→承認依頼→承認→署名済み正本添付→交付）をtool層を経由せずservice層で直接通し、
 * 監査ログの完全性とnonce/hash/期限のガードを検証する
 *
 * M1 gate verification (design doc §11 Done条件):
 *   "Every operation on a single case is traceable with actor/timestamp/version/hash.
 *    approval_requests' nonce/hash/expiry actually function"
 * Drives the labor-conditions-notice vertical slice (draft -> request_approval -> approve ->
 * attach_executed_copy -> record_delivery) directly through the service layer and verifies audit
 * completeness plus the nonce/hash/expiry guards
 *
 * Verifikasi gate M1 (Done条件 §11 dokumen desain):
 *   "Setiap operasi pada satu kasus dapat dilacak dengan actor/waktu/versi/hash.
 *    nonce/hash/kedaluwarsa approval_requests benar-benar berfungsi"
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, getPool, type TenantScopedDb } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/audit.js";
import { approvalRequests, documents } from "../src/db/schema/documents.js";
import { dispatchAssignments } from "../src/db/schema/ledgers.js";
import { previewLaborConditionsNotice } from "../src/services/documents/preview.js";
import { generateLaborConditionsNoticeDraft } from "../src/services/documents/generate-draft.js";
import { requestDocumentApproval } from "../src/services/documents/request-approval.js";
import { approveDocument } from "../src/services/documents/approve.js";
import { attachExecutedCopy } from "../src/services/documents/attach-executed-copy.js";
import { recordDelivery } from "../src/services/documents/record-delivery.js";
import { verifyChain } from "../src/audit/hash-chain.js";
import { InvalidTransitionError } from "../src/lib/errors.js";
import { assertScope, type AuthenticatedPrincipal } from "../src/lib/auth.js";
import type { LaborConditionsNotice } from "../src/domain/labor-conditions-notice.js";
import { closePrivilegedDb, getPrivilegedDb } from "./helpers/privileged-db.js";

const requester: AuthenticatedPrincipal = {
  principalId: "m1-gate-requester",
  role: "requester",
  authMethod: "local_fixed_token",
  tenantId: "m1-gate-tenant",
};

const approver: AuthenticatedPrincipal = {
  principalId: "m1-gate-approver",
  role: "approver",
  authMethod: "local_fixed_token",
  tenantId: "m1-gate-tenant",
};

const systemPrincipal: AuthenticatedPrincipal = {
  principalId: "m1-gate-system",
  role: "system",
  authMethod: "local_fixed_token",
  tenantId: "m1-gate-tenant",
};

const SAMPLE_CONDITIONS: LaborConditionsNotice = {
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
};

let tenantId: string;
// RLSを実効性あるものとして検証するため、本番と同じacquireTenantScopedDbを使う（詳細はaudit-chain.test.ts参照）
// Uses acquireTenantScopedDb, the same mechanism production uses, so RLS is genuinely exercised (see audit-chain.test.ts)
// Menggunakan acquireTenantScopedDb, mekanisme yang sama dengan produksi, sehingga RLS benar-benar diuji (lihat audit-chain.test.ts)
let tenantScoped: TenantScopedDb;
let db: TenantScopedDb["db"];

async function insertDispatchAssignment(): Promise<string> {
  const id = randomUUID();
  await db.insert(dispatchAssignments).values({
    id,
    tenantId,
    staffId: randomUUID(),
    companyId: randomUUID(),
    startDate: "2026-07-01",
    conditionsTyped: SAMPLE_CONDITIONS,
  });
  return id;
}

beforeAll(async () => {
  tenantId = randomUUID();
  tenantScoped = await acquireTenantScopedDb(tenantId);
  db = tenantScoped.db;
});

afterAll(async () => {
  await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId));
  await db.delete(documents).where(eq(documents.tenantId, tenantId));
  await db.delete(dispatchAssignments).where(eq(dispatchAssignments.tenantId, tenantId));
  // audit_eventsはruntimeロールからDELETEを剥奪しているため、後始末はsuperuser相当の接続で行う
  // audit_events has DELETE revoked from the runtime role, so cleanup uses the superuser-equivalent connection
  await getPrivilegedDb().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  tenantScoped.release();
  await getPool().end();
  await closePrivilegedDb();
});

describe("M1ゲート: 労働条件通知書の縦切り一本 / M1 gate: labor-conditions-notice vertical slice", () => {
  it("全項目が揃っている場合、previewはpassを返す / preview returns pass when every field is present", async () => {
    const dispatchAssignmentId = await insertDispatchAssignment();
    const preview = await previewLaborConditionsNotice(db, { tenantId, dispatchAssignmentId });
    expect(preview.findings).toEqual([]);
    expect(preview.renderedText).toContain("あずま園");
  });

  it("draft→承認依頼→承認→署名済み添付→交付の全操作がactor・時刻・版・ハッシュ付きでaudit_eventsに追跡可能 / every step is traceable in audit_events with actor/timestamp/version/hash", async () => {
    const dispatchAssignmentId = await insertDispatchAssignment();

    const draft = await generateLaborConditionsNoticeDraft(db, {
      tenantId,
      dispatchAssignmentId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M1ゲートテスト",
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

    const approval = await approveDocument(db, {
      tenantId,
      principal: approver,
      requestId: randomUUID(),
      approvalRequestId: approvalRequest.approvalRequestId,
      decision: "approved",
      decisionReason: "内容確認済み",
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

    const finalDocument = await db.select().from(documents).where(eq(documents.id, draft.documentId));
    expect(finalDocument[0]?.contentStatus).toBe("approved");
    expect(finalDocument[0]?.executionStatus).toBe("executed");
    expect(finalDocument[0]?.deliveryStatus).toBe("delivered");

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
    // actor・時刻・ハッシュが全件で埋まっている（版はaggregate_versionとして記録） / actor/timestamp/hash present on every row (version recorded as aggregate_version) / actor/waktu/hash ada di setiap baris (versi dicatat sebagai aggregate_version)
    for (const event of trail) {
      expect(event.actorPrincipalId).toBeTruthy();
      expect(event.occurredAt).toBeInstanceOf(Date);
      expect(event.afterHash).toBeTruthy();
      expect(event.aggregateVersion).toBe(1);
      expect(event.eventHash).toBeTruthy();
    }

    const problems = await verifyChain(db, tenantId);
    expect(problems).toEqual([]);
  });

  it("原本のhashが1バイトでも変わればapproveは自動的にvoidされる / approve auto-voids on a single-byte artifact hash change", async () => {
    const dispatchAssignmentId = await insertDispatchAssignment();
    const draft = await generateLaborConditionsNoticeDraft(db, {
      tenantId,
      dispatchAssignmentId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M1ゲートテスト",
    });
    const approvalRequest = await requestDocumentApproval(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      documentId: draft.documentId,
      requiredRole: "approver",
    });

    // 原本が(バグや競合更新で)変化した状況を再現する / simulates the source artifact changing (e.g. bug or racing update) / mensimulasikan artifact sumber berubah (misalnya bug atau update yang bersaing)
    await db.update(documents).set({ generatedSha256: "tampered-hash-value" }).where(eq(documents.id, draft.documentId));

    await expect(
      approveDocument(db, {
        tenantId,
        principal: approver,
        requestId: randomUUID(),
        approvalRequestId: approvalRequest.approvalRequestId,
        decision: "approved",
        decisionReason: "内容確認済み",
      }),
    ).rejects.toThrow(InvalidTransitionError);

    const [voided] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalRequest.approvalRequestId));
    expect(voided?.decision).toBe("rejected");
    expect(voided?.decisionReason).toBe("artifact_hash_mismatch");
  });

  it("期限切れのapproval_requestは承認できずexpiredになる / an expired approval_request cannot be approved and becomes expired", async () => {
    const dispatchAssignmentId = await insertDispatchAssignment();
    const draft = await generateLaborConditionsNoticeDraft(db, {
      tenantId,
      dispatchAssignmentId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M1ゲートテスト",
    });
    const approvalRequest = await requestDocumentApproval(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      documentId: draft.documentId,
      requiredRole: "approver",
    });

    // 期限を過去に書き換えて期限切れ状態を再現する / rewrites the expiry into the past to simulate expiration / menulis ulang kedaluwarsa ke masa lalu untuk simulasi kedaluwarsa
    await db
      .update(approvalRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(approvalRequests.id, approvalRequest.approvalRequestId));

    await expect(
      approveDocument(db, {
        tenantId,
        principal: approver,
        requestId: randomUUID(),
        approvalRequestId: approvalRequest.approvalRequestId,
        decision: "approved",
        decisionReason: "内容確認済み",
      }),
    ).rejects.toThrow(InvalidTransitionError);

    const [expired] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalRequest.approvalRequestId));
    expect(expired?.decision).toBe("expired");
  });

  it("nonceはapproval_request毎に一意である / nonce is unique per approval_request", async () => {
    const dispatchAssignmentId = await insertDispatchAssignment();
    const draftA = await generateLaborConditionsNoticeDraft(db, {
      tenantId,
      dispatchAssignmentId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M1ゲートテスト",
    });
    const dispatchAssignmentId2 = await insertDispatchAssignment();
    const draftB = await generateLaborConditionsNoticeDraft(db, {
      tenantId,
      dispatchAssignmentId: dispatchAssignmentId2,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "M1ゲートテスト",
    });

    const approvalA = await requestDocumentApproval(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      documentId: draftA.documentId,
      requiredRole: "approver",
    });
    const approvalB = await requestDocumentApproval(db, {
      tenantId,
      principal: requester,
      requestId: randomUUID(),
      documentId: draftB.documentId,
      requiredRole: "approver",
    });

    expect(approvalA.nonce).not.toBe(approvalB.nonce);
  });

  it("document.generate_draftは同一idempotencyKeyの再実行で同一documentを返す（重複draftを作らない） / document.generate_draft returns the same document on retry with the same idempotencyKey (no duplicate drafts)", async () => {
    const dispatchAssignmentId = await insertDispatchAssignment();
    const idempotencyKey = randomUUID();

    const first = await generateLaborConditionsNoticeDraft(db, {
      tenantId,
      dispatchAssignmentId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey,
      reason: "冪等性テスト",
    });

    const retry = await generateLaborConditionsNoticeDraft(db, {
      tenantId,
      dispatchAssignmentId,
      principal: requester,
      requestId: randomUUID(),
      idempotencyKey,
      reason: "冪等性テスト（リトライ）",
    });

    expect(retry.documentId).toBe(first.documentId);

    const rows = await db.select().from(documents).where(eq(documents.subjectId, dispatchAssignmentId));
    expect(rows).toHaveLength(1);
  });

  it("write系ツールはrole=systemからの呼び出しを認可レイヤーで拒否する / write tools reject calls from role=system at the authorization layer", () => {
    expect(() => assertScope(systemPrincipal, ["requester", "admin"])).toThrow();
    expect(() => assertScope(systemPrincipal, ["approver", "admin"])).toThrow();
    expect(() => assertScope(systemPrincipal, ["requester", "approver", "admin"])).toThrow();
    // 正当なroleは通ることも確認する / also verify legitimate roles pass / juga verifikasi role yang sah lolos
    expect(() => assertScope(requester, ["requester", "admin"])).not.toThrow();
    expect(() => assertScope(approver, ["approver", "admin"])).not.toThrow();
  });
});

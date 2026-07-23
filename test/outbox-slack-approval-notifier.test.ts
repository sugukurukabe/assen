/**
 * 自社MVPゲート検証（docs/registry-readiness-checklist.md G節）：document.request_approvalが
 * outboxへdocument.approval_requestedイベントを積むこと、およびそのSlack通知handler
 * （notifySlackOnApprovalRequested）が正しいpayloadを処理してoutbox行をdoneにすることを検証する。
 * ローカル/CIではSLACK_BOT_TOKEN・SLACK_APPROVAL_CHANNEL_IDが未設定のため、handlerはSlackへの
 * 実際のネットワーク呼び出しを行わずログ出力に留まる（src/lib/slack-notifier.ts参照）
 *
 * Internal-MVP gate verification (docs/registry-readiness-checklist.md section G): confirms
 * document.request_approval enqueues a document.approval_requested outbox event, and that its Slack
 * notification handler (notifySlackOnApprovalRequested) processes a well-formed payload and marks the outbox
 * row done. Locally/in CI, SLACK_BOT_TOKEN and SLACK_APPROVAL_CHANNEL_ID are unset, so the handler never makes a
 * real network call and only logs (see src/lib/slack-notifier.ts)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, getPool, type TenantScopedDb } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/audit.js";
import { approvalRequests, documents } from "../src/db/schema/documents.js";
import { dispatchAssignments } from "../src/db/schema/ledgers.js";
import { transactionalOutbox } from "../src/db/schema/outbox.js";
import { generateLaborConditionsNoticeDraft } from "../src/services/documents/generate-draft.js";
import { requestDocumentApproval } from "../src/services/documents/request-approval.js";
import { processOutboxBatch } from "../src/services/outbox-worker/worker.js";
import { notifySlackOnApprovalRequested } from "../src/services/outbox-worker/handlers/slack-approval-notifier.js";
import type { AuthenticatedPrincipal } from "../src/lib/auth.js";
import type { LaborConditionsNotice } from "../src/domain/labor-conditions-notice.js";
import { closePrivilegedDb, getPrivilegedDb } from "./helpers/privileged-db.js";

const requester: AuthenticatedPrincipal = {
  principalId: "outbox-slack-requester",
  role: "requester",
  authMethod: "local_fixed_token",
  tenantId: "outbox-slack-tenant",
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

let tenantScoped: TenantScopedDb | undefined;
let activeTenantId: string | undefined;

afterEach(async () => {
  if (tenantScoped && activeTenantId) {
    const { db } = tenantScoped;
    const tenantId = activeTenantId;
    await db.delete(approvalRequests).where(eq(approvalRequests.tenantId, tenantId));
    await db.delete(documents).where(eq(documents.tenantId, tenantId));
    await db.delete(dispatchAssignments).where(eq(dispatchAssignments.tenantId, tenantId));
    await getPrivilegedDb().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
    tenantScoped.release();
    tenantScoped = undefined;
    activeTenantId = undefined;
  }
});

afterAll(async () => {
  await getPool().end();
  await closePrivilegedDb();
});

async function setUpApprovalRequest(): Promise<{ db: TenantScopedDb["db"]; tenantId: string; approvalRequestId: string }> {
  const tenantId = randomUUID();
  tenantScoped = await acquireTenantScopedDb(tenantId);
  activeTenantId = tenantId;
  const { db } = tenantScoped;

  const dispatchAssignmentId = randomUUID();
  await db.insert(dispatchAssignments).values({
    id: dispatchAssignmentId,
    tenantId,
    staffId: randomUUID(),
    companyId: randomUUID(),
    startDate: "2026-07-01",
    conditionsTyped: SAMPLE_CONDITIONS,
  });

  const draft = await generateLaborConditionsNoticeDraft(db, {
    tenantId,
    subjectId: dispatchAssignmentId,
    principal: requester,
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "outbox Slack通知テスト",
  });

  const approvalRequest = await requestDocumentApproval(db, {
    tenantId,
    principal: requester,
    requestId: randomUUID(),
    documentId: draft.documentId,
    requiredRole: "approver",
  });

  return { db, tenantId, approvalRequestId: approvalRequest.approvalRequestId };
}

describe("outbox: document.approval_requestedのSlack通知 / outbox: Slack notification for document.approval_requested", () => {
  it("document.request_approvalはdocType/subjectId/requiredRole/requestedBy/expiresAtを含むoutbox行を積む（hash/nonceは含まない） / document.request_approval enqueues an outbox row carrying docType/subjectId/requiredRole/requestedBy/expiresAt (never hash/nonce)", async () => {
    const { db, tenantId, approvalRequestId } = await setUpApprovalRequest();

    const [row] = await db
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, approvalRequestId));

    expect(row?.tenantId).toBe(tenantId);
    expect(row?.eventType).toBe("document.approval_requested");
    expect(row?.externalReference).toBe(approvalRequestId);

    const payload = row?.payload as Record<string, unknown>;
    expect(payload.approvalRequestId).toBe(approvalRequestId);
    expect(payload.docType).toBe("labor_conditions_notice");
    expect(payload.requiredRole).toBe("approver");
    expect(payload.requestedBy).toBe(requester.principalId);
    expect(typeof payload.expiresAt).toBe("string");
    expect(payload).not.toHaveProperty("nonce");
    expect(payload).not.toHaveProperty("generatedSha256");
  });

  it("notifySlackOnApprovalRequestedはSlack未設定のローカル環境でも例外を投げずoutbox行がdoneになる / notifySlackOnApprovalRequested does not throw even without Slack configured, and the outbox row becomes done", async () => {
    const { db, approvalRequestId } = await setUpApprovalRequest();

    // setUpApprovalRequestはgenerate-draft経由でdocument.draft_generated行も積んでいる。この行はrun.tsの設計どおり
    // handler未登録のままdead-letterされる（意図した挙動。詳細はsrc/services/outbox-worker/run.tsのコメント参照）
    // setUpApprovalRequest also enqueues a document.draft_generated row via generate-draft. That row is
    // intentionally left unregistered and dead-letters per run.ts's design (see its comments for details)
    await processOutboxBatch(db, {
      "document.approval_requested": notifySlackOnApprovalRequested,
    });

    const [approvalRequestedRow] = await db
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, approvalRequestId));
    expect(approvalRequestedRow?.status).toBe("done");
  });

  it("payload形式が不正なイベントはhandlerが例外を投げ、再試行スケジュールされる / a malformed payload makes the handler throw and schedules a retry", async () => {
    const tenantId = randomUUID();
    tenantScoped = await acquireTenantScopedDb(tenantId);
    activeTenantId = tenantId;
    const { db } = tenantScoped;

    const idempotencyKey = randomUUID();
    await db.transaction(async (tx) => {
      const { enqueueOutboxEvent } = await import("../src/services/outbox-worker/enqueue.js");
      await enqueueOutboxEvent(tx, {
        tenantId,
        aggregateType: "document",
        aggregateId: randomUUID(),
        eventType: "document.approval_requested",
        payload: { onlyThisField: "not a valid approval-requested payload" },
        idempotencyKey,
      });
    });

    const { failed } = await processOutboxBatch(db, {
      "document.approval_requested": notifySlackOnApprovalRequested,
    });
    expect(failed).toBe(1);

    const [row] = await db.select().from(transactionalOutbox).where(eq(transactionalOutbox.idempotencyKey, idempotencyKey));
    expect(row?.status).toBe("pending");
    expect(row?.attemptCount).toBe(1);
  });
});

/**
 * document.approval_requested outboxイベントのSlack通知handler（自社MVPゲート、docs/registry-readiness-checklist.md G節）。
 * request-approval.tsがpayloadへ積む識別子のみを通知し、承認対象のhash・nonceなど機微情報は含めない
 *
 * Slack-notification handler for the document.approval_requested outbox event (internal-MVP gate; checklist
 * section G). Only notifies the identifiers request-approval.ts places in the payload; sensitive fields like the
 * artifact hash/nonce are never included
 *
 * Handler notifikasi Slack untuk event outbox document.approval_requested (gate MVP internal; bagian G checklist).
 * Hanya memberi tahu pengenal yang dimasukkan request-approval.ts ke payload; field sensitif seperti hash/nonce
 * artifact tidak pernah disertakan
 */
import { z } from "zod";
import { postSlackMessage } from "../../../lib/slack-notifier.js";
import type { OutboxHandler } from "../worker.js";

const approvalRequestedPayloadSchema = z.object({
  approvalRequestId: z.string(),
  documentId: z.string(),
  docType: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  requiredRole: z.string(),
  requestedBy: z.string(),
  expiresAt: z.string(),
});

function formatApprovalRequestedMessage(payload: z.infer<typeof approvalRequestedPayloadSchema>): string {
  return [
    "書類の承認依頼があります / A document is waiting for approval",
    `docType: ${payload.docType} (subjectId: ${payload.subjectId})`,
    `依頼者 / requested by: ${payload.requestedBy} / 必要ロール / required role: ${payload.requiredRole}`,
    `期限 / expires at: ${payload.expiresAt}`,
    `approval_request_id: ${payload.approvalRequestId}`,
    "document.approve（またはdocument.reject）で対応してください / Please act via document.approve (or a rejection decision)",
  ].join("\n");
}

export const notifySlackOnApprovalRequested: OutboxHandler = async (event) => {
  const payload = approvalRequestedPayloadSchema.parse(event.payload);
  await postSlackMessage({ text: formatApprovalRequestedMessage(payload) });
};

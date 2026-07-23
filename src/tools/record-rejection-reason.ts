/**
 * placement.record_rejection_reason：outcome=rejected確定済みの紹介行に不採用理由（⑧への回答）を記録する
 * （write系。idempotency_key/reason必須）
 * placement.record_rejection_reason: records the non-hire reason (reply to document ⑧) on a referral row
 * already confirmed as outcome=rejected (write tool; requires idempotency_key/reason)
 * placement.record_rejection_reason: mencatat alasan tidak diterima (balasan atas dokumen ⑧) pada baris
 * rujukan yang sudah dikonfirmasi outcome=rejected (tool write; memerlukan idempotency_key/reason)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { recordRejectionReason } from "../services/documents/record-rejection-reason.js";
import { t2pReferralConditionsInputSchema } from "../domain/t2p-referral-conditions.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const inputSchema = {
  idempotencyKey: z.string().min(1).describe("冪等キー。同一操作の再実行で副作用を1回に保つ / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("記録理由 / Reason for recording / Alasan pencatatan"),
  jobOrderReferralId: z.string().uuid().describe("placement.confirmでoutcome=rejectedを確定済みの紹介行ID / Referral id already confirmed as outcome=rejected via placement.confirm / Id rujukan yang sudah dikonfirmasi outcome=rejected via placement.confirm"),
  rejectionReason: z.string().min(1).describe("派遣先から明示された不採用理由 / Non-hire reason stated by the client / Alasan tidak diterima yang dinyatakan klien"),
  rejectionReasonReceivedAt: z.string().min(1).describe("理由を受領した年月日(YYYY-MM-DD) / Date the reason was received / Tanggal alasan diterima"),
  additionalDetails: t2pReferralConditionsInputSchema
    .partial()
    .optional()
    .describe(
      "⑨不採用理由の書面明示の差込項目（rejectionReason以外。nonHireCategory・noticeDate・noticeMethod等） / Fields for ⑨ other than rejectionReason (nonHireCategory, noticeDate, noticeMethod, etc.) / Field untuk ⑨ selain rejectionReason (nonHireCategory, noticeDate, noticeMethod, dll.)",
    ),
};

export function registerRecordRejectionReason(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "placement.record_rejection_reason",
    {
      title: "不採用理由を記録する",
      description:
        "outcome=rejectedで確定済みの紹介行（job_order_referrals）に、派遣先から受領した不採用理由（⑧不採用理由の明示請求への回答）を記録する。記録後、document.generate_draft（docType=t2p_non_hire_reason_notice）で⑨不採用理由の書面明示を生成できる。 / Records the non-hire reason received from the client (reply to ⑧ non-hire-reason request) on a referral row already confirmed as outcome=rejected. Once recorded, document.generate_draft (docType=t2p_non_hire_reason_notice) can generate document ⑨. / Mencatat alasan tidak diterima yang diterima dari klien (balasan atas permintaan alasan tidak diterima ⑧) pada baris rujukan yang sudah dikonfirmasi outcome=rejected. Setelah dicatat, document.generate_draft (docType=t2p_non_hire_reason_notice) dapat menghasilkan dokumen ⑨.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "admin"]);

        const result = await recordRejectionReason(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          idempotencyKey: args.idempotencyKey,
          reason: args.reason,
          jobOrderReferralId: args.jobOrderReferralId,
          rejectionReason: args.rejectionReason,
          rejectionReasonReceivedAt: args.rejectionReasonReceivedAt,
          additionalDetails: args.additionalDetails,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobOrderReferralId,
          subjectVersion: 3,
          status: result.alreadyProcessed ? "already_confirmed" : "confirmed",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://audit/job_order_referral/${result.jobOrderReferralId}`],
          nextActions: ["document.generate_draftでdocType=t2p_non_hire_reason_notice（⑨）を生成してください"],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "placement.record_rejection_reasonに失敗しました / placement.record_rejection_reason failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "不採用理由の記録に失敗しました / Failed to record the non-hire reason",
          "入力内容を確認し、再度お試しください。問題が続く場合はシステム管理者にご連絡ください。",
        );
      }
    },
  );
}

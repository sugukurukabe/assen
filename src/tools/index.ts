/**
 * 全ツールの登録集約（1ファイル1ツール、register{ToolName}パターン）
 * Aggregates registration of every tool (one file per tool, register{ToolName} pattern)
 * Mengagregasi registrasi setiap tool (satu file per tool, pola register{ToolName})
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { registerJobOrderAnalyze } from "./job-order-analyze.js";
import { registerJobOrderConfirm } from "./job-order-confirm.js";
import { registerDispatchAssignmentConfirm } from "./dispatch-assignment-confirm.js";
import { registerComplianceEvaluate } from "./compliance-evaluate.js";
import { registerDocumentPreview } from "./document-preview.js";
import { registerDocumentGenerateDraft } from "./document-generate-draft.js";
import { registerDocumentRequestApproval } from "./document-request-approval.js";
import { registerDocumentApprove } from "./document-approve.js";
import { registerDocumentAttachExecutedCopy } from "./document-attach-executed-copy.js";
import { registerDocumentRecordDelivery } from "./document-record-delivery.js";
import { registerDocumentSupersede } from "./document-supersede.js";
import { registerJobSeekerConfirm } from "./job-seeker-confirm.js";
import { registerJobOrderReferralConfirm } from "./job-order-referral-confirm.js";
import { registerPlacementConfirm } from "./placement-confirm.js";
import { registerRecordRejectionReason } from "./record-rejection-reason.js";

export function registerAllTools(server: McpServer, context: ServiceContext): void {
  registerJobOrderAnalyze(server, context);
  registerJobOrderConfirm(server, context);
  registerDispatchAssignmentConfirm(server, context);
  registerComplianceEvaluate(server, context);
  registerDocumentPreview(server, context);
  registerDocumentGenerateDraft(server, context);
  registerDocumentRequestApproval(server, context);
  registerDocumentApprove(server, context);
  registerDocumentAttachExecutedCopy(server, context);
  registerDocumentRecordDelivery(server, context);
  registerDocumentSupersede(server, context);
  registerJobSeekerConfirm(server, context);
  registerJobOrderReferralConfirm(server, context);
  registerPlacementConfirm(server, context);
  registerRecordRejectionReason(server, context);
}

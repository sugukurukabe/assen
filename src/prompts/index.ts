/**
 * 業務フロープロンプトの登録集約（求人取込〜承認の3本）
 * Aggregates registration of workflow prompts (job-order intake through approval, 3 flows)
 * Mengagregasi registrasi prompt workflow (dari intake lowongan hingga persetujuan, 3 alur)
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { registerIntakeJobOrderPrompt } from "./intake-job-order.js";
import { registerReviewPendingApprovalsPrompt } from "./review-pending-approvals.js";
import { registerCorrectDocumentPrompt } from "./correct-document.js";

export function registerAllPrompts(server: McpServer, context: ServiceContext): void {
  registerIntakeJobOrderPrompt(server, context);
  registerReviewPendingApprovalsPrompt(server, context);
  registerCorrectDocumentPrompt(server, context);
}

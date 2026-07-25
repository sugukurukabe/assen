/**
 * 業務フロープロンプトの登録集約
 * Aggregates registration of workflow prompts
 * Mengagregasi registrasi prompt workflow
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { registerIntakeJobOrderPrompt } from "./intake-job-order.js";
import { registerReviewPendingApprovalsPrompt } from "./review-pending-approvals.js";
import { registerCorrectDocumentPrompt } from "./correct-document.js";
import { registerMorningScanPrompt } from "./morning-scan.js";
import { registerMatchCandidatesPrompt } from "./match-candidates.js";
import { registerWeeklyReviewPrompt } from "./weekly-review.js";
import { registerStage0IntakePrompt } from "./stage0-intake.js";
import { registerWf25hPlacementPrompt } from "./wf-25h-placement.js";

export function registerAllPrompts(server: McpServer, context: ServiceContext): void {
  registerIntakeJobOrderPrompt(server, context);
  registerReviewPendingApprovalsPrompt(server, context);
  registerCorrectDocumentPrompt(server, context);
  registerMorningScanPrompt(server, context);
  registerMatchCandidatesPrompt(server, context);
  registerWeeklyReviewPrompt(server, context);
  registerStage0IntakePrompt(server, context);
  registerWf25hPlacementPrompt(server, context);
}

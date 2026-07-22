/**
 * document.approve：承認。actorは認証主体から導出。入力で承認者名を受けない
 * document.approve: approval. The actor is derived from the authenticated principal; approver names are never accepted as input
 * document.approve: persetujuan. Actor diturunkan dari principal terautentikasi; nama approver tidak pernah diterima sebagai input
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { approveDocument } from "../services/documents/approve.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { ExpertReviewRequiredError, InvalidTransitionError, UserInputError } from "../lib/errors.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  approvalRequestId: z.string().uuid().describe("document.request_approvalが返したID / approvalRequestId returned by document.request_approval / approvalRequestId yang dikembalikan document.request_approval"),
  decision: z.enum(["approved", "rejected"]).describe("承認または差戻し / approve or reject / setujui atau tolak"),
  decisionReason: z.string().min(1).describe("判断理由 / Reason for the decision / Alasan keputusan"),
};

export function registerDocumentApprove(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "document.approve",
    {
      title: "書類を承認・差戻しする",
      description:
        "承認依頼を承認または差戻しする。承認者は認証主体から導出し、入力からは受け取らない。ambiguous/expert_review_requiredのfindingsが残っている場合は承認をブロックする。承認対象のハッシュが変化していれば自動的に無効化する。 / Approves or rejects an approval request. The approver is derived from the authenticated principal, never from input. Blocks approval while ambiguous/expert_review_required findings remain. Auto-voids if the artifact hash changed. / Menyetujui atau menolak permintaan persetujuan. Approver diturunkan dari principal terautentikasi, tidak pernah dari input. Memblokir persetujuan selama masih ada findings ambiguous/expert_review_required. Otomatis membatalkan jika hash artifact berubah.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["approver", "admin"]);

        const result = await approveDocument(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          approvalRequestId: args.approvalRequestId,
          decision: args.decision,
          decisionReason: args.decisionReason,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.documentId,
          subjectVersion: 1,
          status: result.contentStatus,
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://audit/document/${result.documentId}`],
          nextActions:
            result.contentStatus === "approved"
              ? ["document.attach_executed_copyで署名済み正本を添付してください"]
              : ["差戻し理由を確認し、document.generate_draftで再生成してください"],
        });
      } catch (error) {
        if (error instanceof ExpertReviewRequiredError) {
          return toToolErrorResult(error.message);
        }
        if (error instanceof UserInputError || error instanceof InvalidTransitionError) {
          return toToolErrorResult(error.message, error instanceof UserInputError ? error.remediation : undefined);
        }
        logMessage("error", "document.approveに失敗しました / document.approve failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("承認処理に失敗しました / Failed to process the approval");
      }
    },
  );
}

/**
 * document.request_approval：approval_requests作成（hash・nonce・期限つき）。write系
 * document.request_approval: creates an approval_requests row (with hash/nonce/expiry). Write tool
 * document.request_approval: membuat baris approval_requests (dengan hash/nonce/kedaluwarsa). Tool write
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { requestDocumentApproval } from "../services/documents/request-approval.js";
import { toToolErrorResult, toToolResultWithLinks } from "./common-envelope.js";
import { InvalidTransitionError, UserInputError } from "../lib/errors.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  documentId: z.string().uuid().describe("承認を依頼するdocumentのID / documentId to request approval for / documentId untuk meminta persetujuan"),
  requiredRole: z.string().min(1).describe("承認に必要なロール / Role required to approve / Role yang diperlukan untuk menyetujui"),
};

export function registerDocumentRequestApproval(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "document.request_approval",
    {
      title: "書類の承認を依頼する",
      description:
        "承認対象文書のハッシュ・nonce・期限を持つapproval_requestsを作成し、content_statusをunder_reviewへ遷移させる。 / Creates an approval_requests row carrying the artifact hash/nonce/expiry and transitions content_status to under_review. / Membuat baris approval_requests yang membawa hash/nonce/kedaluwarsa artifact dan mentransisikan content_status ke under_review.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "admin"]);

        const result = await requestDocumentApproval(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          documentId: args.documentId,
          requiredRole: args.requiredRole,
        });

        return toToolResultWithLinks(
          {
            operationId: randomUUID(),
            subjectId: args.documentId,
            subjectVersion: 1,
            status: "under_review",
            missingFields: [],
            findings: [],
            evidenceRefs: [`ui://approval/${result.approvalRequestId}`],
            nextActions: [
              `承認画面（ui://approval/${result.approvalRequestId}）を確認し、document.approveをnonce=${result.nonce}で呼び出して承認または差戻ししてください`,
            ],
            approvalRequestId: result.approvalRequestId,
            nonce: result.nonce,
            expiresAt: result.expiresAt.toISOString(),
          },
          [
            {
              uri: `ui://approval/${result.approvalRequestId}`,
              name: "書類承認画面 / Document approval screen / Layar persetujuan dokumen",
              description: "MCP App承認画面（sandboxed iframeで表示） / MCP App approval screen (rendered in a sandboxed iframe) / Layar persetujuan MCP App (dirender dalam sandboxed iframe)",
              mimeType: "text/html",
            },
          ],
        );
      } catch (error) {
        if (error instanceof UserInputError || error instanceof InvalidTransitionError) {
          return toToolErrorResult(error.message, error instanceof UserInputError ? error.remediation : undefined);
        }
        logMessage("error", "document.request_approvalに失敗しました / document.request_approval failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("承認依頼の作成に失敗しました / Failed to create the approval request");
      }
    },
  );
}

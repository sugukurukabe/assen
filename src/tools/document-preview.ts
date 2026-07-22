/**
 * document.preview：生成前プレビュー（差込値・出典・充足状況）。read系
 * document.preview: pre-generation preview (merged values, provenance, completeness). Read-only
 * document.preview: preview sebelum generate (nilai gabungan, provenance, kelengkapan). Read-only
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { previewLaborConditionsNotice } from "../services/documents/preview.js";
import { overallResult } from "../services/rules/five-value-result.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { UserInputError } from "../lib/errors.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  dispatchAssignmentId: z.string().uuid().describe("労働条件通知書の対象となる派遣就業ID / Target dispatch assignment id / ID penugasan dispatch target"),
};

export function registerDocumentPreview(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "document.preview",
    {
      title: "書類の生成前プレビューを表示する",
      description:
        "労働条件通知書の生成前プレビューを返す。差込値・出典・法定必須項目の充足状況を確認できる。DBは変更しない。 / Returns a pre-generation preview of the working-conditions notice: merged values, provenance, and legal-field completeness. Never mutates the DB. / Mengembalikan preview sebelum generate untuk pemberitahuan kondisi kerja: nilai gabungan, provenance, dan kelengkapan field hukum. Tidak pernah mengubah DB.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await previewLaborConditionsNotice(context.db, {
          tenantId: context.principal.tenantId,
          dispatchAssignmentId: args.dispatchAssignmentId,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: args.dispatchAssignmentId,
          subjectVersion: 1,
          status: overallResult(result.findings),
          missingFields: result.findings.flatMap((finding) => finding.missingFields),
          findings: result.findings,
          renderedPreview: result.renderedText,
          evidenceRefs: [`assen://audit/dispatch_assignment/${args.dispatchAssignmentId}`],
          nextActions:
            overallResult(result.findings) === "pass"
              ? ["document.generate_draftでドラフトを生成してください"]
              : ["充足していない項目を解消してから再度プレビューしてください"],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "document.previewに失敗しました / document.preview failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("プレビューの生成に失敗しました / Failed to build the preview");
      }
    },
  );
}

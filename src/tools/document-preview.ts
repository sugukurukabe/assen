/**
 * document.preview：生成前プレビュー（差込値・出典・充足状況）。read系
 * document.preview: pre-generation preview (merged values, provenance, completeness). Read-only
 * document.preview: preview sebelum generate (nilai gabungan, provenance, kelengkapan). Read-only
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { previewDocument } from "../services/documents/preview.js";
import { getDocTypeDefinition, SUPPORTED_DOC_TYPES } from "../services/documents/doc-type-registry.js";
import { overallResult } from "../services/rules/five-value-result.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { UserInputError } from "../lib/errors.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  docType: z
    .enum(SUPPORTED_DOC_TYPES)
    .default("labor_conditions_notice")
    .describe(
      "プレビュー対象の書類種別（docs/document-catalog.md参照）。未指定時はM1既定のlabor_conditions_notice / Document type to preview (see docs/document-catalog.md). Defaults to labor_conditions_notice / Jenis dokumen yang di-preview (lihat docs/document-catalog.md). Default ke labor_conditions_notice",
    ),
  subjectId: z
    .string()
    .uuid()
    .describe(
      "対象ID（docTypeのsubjectTypeにより派遣就業IDまたは紹介行IDのいずれか） / Target subject id (dispatch assignment id or referral id, depending on the docType's subjectType) / ID subjek target (id penugasan dispatch atau id rujukan, sesuai subjectType docType)",
    ),
};

export function registerDocumentPreview(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "document.preview",
    {
      title: "書類の生成前プレビューを表示する",
      description:
        "指定したdocTypeの生成前プレビューを返す。差込値・出典・法定必須項目の充足状況を確認できる。subjectIdはdocTypeのsubjectTypeにより派遣就業ID（dispatch_assignment）または紹介行ID（job_order_referral）を指定する。DBは変更しない。 / Returns a pre-generation preview of the given docType: merged values, provenance, and legal-field completeness. subjectId is either a dispatch assignment id or a referral id, depending on the docType's subjectType. Never mutates the DB. / Mengembalikan preview sebelum generate untuk docType yang diberikan: nilai gabungan, provenance, dan kelengkapan field hukum. subjectId adalah id penugasan dispatch atau id rujukan, sesuai subjectType docType. Tidak pernah mengubah DB.",
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const result = await previewDocument(context.db, {
          tenantId: context.principal.tenantId,
          docType: args.docType,
          subjectId: args.subjectId,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: args.subjectId,
          subjectVersion: 1,
          status: overallResult(result.findings),
          missingFields: result.findings.flatMap((finding) => finding.missingFields),
          findings: result.findings,
          renderedPreview: result.renderedText,
          evidenceRefs: [`assen://audit/${getDocTypeDefinition(args.docType)?.subjectType ?? args.docType}/${args.subjectId}`],
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

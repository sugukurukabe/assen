/**
 * document.generate_draft：draft生成（GCS/MinIO保存＋documents行作成）。write系
 * document.generate_draft: creates the draft (storage write + documents row). Write tool
 * document.generate_draft: membuat draft (write storage + baris documents). Tool write
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { generateDocumentDraft } from "../services/documents/generate-draft.js";
import { SUPPORTED_DOC_TYPES } from "../services/documents/doc-type-registry.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { UserInputError } from "../lib/errors.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  docType: z
    .enum(SUPPORTED_DOC_TYPES)
    .default("labor_conditions_notice")
    .describe(
      "生成する書類の種別（docs/document-catalog.md参照）。未指定時はM1既定のlabor_conditions_notice / Document type to generate (see docs/document-catalog.md). Defaults to labor_conditions_notice / Jenis dokumen yang dihasilkan (lihat docs/document-catalog.md). Default ke labor_conditions_notice",
    ),
  subjectId: z
    .string()
    .uuid()
    .describe(
      "対象ID（docTypeのsubjectTypeにより派遣就業IDまたは紹介行IDのいずれか） / Target subject id (dispatch assignment id or referral id, depending on the docType's subjectType) / ID subjek target (id penugasan dispatch atau id rujukan, sesuai subjectType docType)",
    ),
  idempotencyKey: z.string().min(1).describe("冪等キー / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("生成理由 / Reason for generation / Alasan pembuatan"),
};

export function registerDocumentGenerateDraft(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "document.generate_draft",
    {
      title: "派遣関連書類のドラフトを生成する",
      description:
        "指定したdocType（labor_conditions_notice/dispatch_individual_contract/dispatch_working_conditions_notice/dispatch_worker_notice/t2p_job_order_notice/t2p_consent_form/t2p_individual_contract/t2p_conversion_memo/t2p_non_hire_reason_request/t2p_non_hire_reason_notice）のドラフトをテンプレートから生成し、GCS/MinIOへcontent-addressableに保存する。subjectIdはdocTypeのsubjectTypeにより派遣就業ID（dispatch_assignment）または紹介行ID（job_order_referral）を指定する。content_statusはdraftになる。 / Generates a draft of the given docType from its template and stores it content-addressably. subjectId is either a dispatch assignment id or a referral id, depending on the docType's subjectType. content_status becomes draft. / Menghasilkan draft docType yang diberikan dari templatenya dan menyimpannya secara content-addressable. subjectId adalah id penugasan dispatch atau id rujukan, sesuai subjectType docType. content_status menjadi draft.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "admin"]);

        const result = await generateDocumentDraft(context.db, {
          tenantId: context.principal.tenantId,
          docType: args.docType,
          subjectId: args.subjectId,
          principal: context.principal,
          requestId: context.requestId,
          idempotencyKey: args.idempotencyKey,
          reason: args.reason,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.documentId,
          subjectVersion: result.version,
          status: "draft",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://documents/${result.logicalDocumentId}/${result.version}`],
          nextActions: ["document.request_approvalで承認依頼を作成してください"],
          generatedSha256: result.generatedSha256,
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "document.generate_draftに失敗しました / document.generate_draft failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("ドラフト生成に失敗しました / Failed to generate the draft");
      }
    },
  );
}

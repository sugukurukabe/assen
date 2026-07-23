/**
 * compliance.evaluate：単一subjectの決定論的ルール判定→findings（5値）。read系（DBを変更しない）
 * compliance.evaluate: deterministic rule judgement for a single subject -> findings (5-value). Read-only (never mutates the DB)
 * compliance.evaluate: penilaian rule deterministik untuk satu subject -> findings (5 nilai). Read-only (tidak pernah mengubah DB)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { dispatchAssignments, jobOrderReferrals, jobOrders } from "../db/schema/ledgers.js";
import { evaluateSubjectCompliance } from "../services/rules/evaluate-subject.js";
import { overallResult } from "../services/rules/five-value-result.js";
import { getDocTypeDefinition, SUPPORTED_DOC_TYPES } from "../services/documents/doc-type-registry.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const SUPPORTED_SUBJECT_TYPES = ["job_order", "dispatch_assignment", "job_order_referral"] as const;

const inputSchema = {
  subjectType: z.enum(SUPPORTED_SUBJECT_TYPES).describe("判定対象の種別 / Subject type to evaluate / Jenis subjek yang dievaluasi"),
  subjectId: z.string().uuid().describe("判定対象のID / Subject id / ID subjek"),
  docType: z
    .enum(SUPPORTED_DOC_TYPES)
    .optional()
    .describe(
      "subjectType=dispatch_assignment/job_order_referralの場合に必須。どの書類を基準に必須項目を判定するか指定する（dispatch_assignment: A2/A3/A10/labor_conditions_notice/⑥、job_order_referral: ④⑤⑦⑧⑨） / Required when subjectType=dispatch_assignment/job_order_referral. Selects which document's required-field set to judge against (dispatch_assignment: A2/A3/A10/labor_conditions_notice/⑥; job_order_referral: ④/⑤/⑦/⑧/⑨) / Wajib saat subjectType=dispatch_assignment/job_order_referral. Memilih set field wajib dokumen mana yang menjadi acuan penilaian (dispatch_assignment: A2/A3/A10/labor_conditions_notice/⑥; job_order_referral: ④/⑤/⑦/⑧/⑨)",
    ),
};

export function registerComplianceEvaluate(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "compliance.evaluate",
    {
      title: "法令遵守状況を判定する",
      description:
        "確認済み事実に対して決定論的ルールで判定し、findingsを5値（pass/fail/incomplete/ambiguous/expert_review_required）で返す。LLMは介在しない。 / Runs deterministic rules against verified facts and returns findings in the 5-value scale. No LLM involvement. / Menjalankan rule deterministik terhadap fakta terverifikasi dan mengembalikan findings dalam skala 5 nilai. Tanpa keterlibatan LLM.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        let mappingFileName: string;
        let row: Record<string, unknown> | undefined;

        if (args.subjectType === "job_order") {
          mappingFileName = "job-order-ledger.json";
          [row] = await context.db.select().from(jobOrders).where(eq(jobOrders.id, args.subjectId));
          if (!row) {
            throw new UserInputError(
              `job_order ${args.subjectId} が見つかりません / job_order ${args.subjectId} not found`,
              "subjectIdを確認してください / Please verify the subjectId",
            );
          }
        } else if (args.subjectType === "dispatch_assignment") {
          if (!args.docType) {
            throw new UserInputError(
              "subjectType=dispatch_assignmentの場合、docTypeが必須です / docType is required when subjectType=dispatch_assignment",
              `docTypeにA2/A3/A10/labor_conditions_noticeのいずれかを指定してください（対応済み: ${SUPPORTED_DOC_TYPES.join(", ")}） / Please specify one of A2/A3/A10/labor_conditions_notice as docType (supported: ${SUPPORTED_DOC_TYPES.join(", ")})`,
            );
          }
          const docTypeDefinition = getDocTypeDefinition(args.docType);
          if (!docTypeDefinition) {
            throw new UserInputError(
              `未対応のdocTypeです / Unsupported docType: ${args.docType}`,
              `対応済みのdocType: ${SUPPORTED_DOC_TYPES.join(", ")}`,
            );
          }
          mappingFileName = docTypeDefinition.mappingFileName;
          [row] = await context.db.select().from(dispatchAssignments).where(eq(dispatchAssignments.id, args.subjectId));
          if (!row) {
            throw new UserInputError(
              `dispatch_assignment ${args.subjectId} が見つかりません / dispatch_assignment ${args.subjectId} not found`,
              "subjectIdを確認してください / Please verify the subjectId",
            );
          }
        } else if (args.subjectType === "job_order_referral") {
          if (!args.docType) {
            throw new UserInputError(
              "subjectType=job_order_referralの場合、docTypeが必須です / docType is required when subjectType=job_order_referral",
              `docTypeに④⑤⑦⑧⑨のいずれかを指定してください（対応済み: ${SUPPORTED_DOC_TYPES.join(", ")}） / Please specify one of ④/⑤/⑦/⑧/⑨ as docType (supported: ${SUPPORTED_DOC_TYPES.join(", ")})`,
            );
          }
          const docTypeDefinition = getDocTypeDefinition(args.docType);
          if (!docTypeDefinition) {
            throw new UserInputError(
              `未対応のdocTypeです / Unsupported docType: ${args.docType}`,
              `対応済みのdocType: ${SUPPORTED_DOC_TYPES.join(", ")}`,
            );
          }
          mappingFileName = docTypeDefinition.mappingFileName;
          [row] = await context.db.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, args.subjectId));
          if (!row) {
            throw new UserInputError(
              `job_order_referral ${args.subjectId} が見つかりません / job_order_referral ${args.subjectId} not found`,
              "subjectIdを確認してください / Please verify the subjectId",
            );
          }
        } else {
          // SUPPORTED_SUBJECT_TYPESが将来増えた場合に到達しうるため、型上はnever化されても実行時ガードとして残す
          // Kept as a runtime guard even though it type-narrows to never today; becomes reachable once SUPPORTED_SUBJECT_TYPES grows
          // Dipertahankan sebagai guard runtime meski ter-narrow ke never saat ini; akan reachable saat SUPPORTED_SUBJECT_TYPES bertambah
          const unsupportedSubjectType = String(args.subjectType);
          throw new UserInputError(
            `未対応のsubjectTypeです / Unsupported subjectType: ${unsupportedSubjectType}`,
            `対応済みのsubjectType: ${SUPPORTED_SUBJECT_TYPES.join(", ")}`,
          );
        }

        const findings = await evaluateSubjectCompliance(context.db, {
          tenantId: context.principal.tenantId,
          subjectType: args.subjectType,
          subjectId: args.subjectId,
          mappingFileName,
          row,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: args.subjectId,
          subjectVersion: 1,
          status: overallResult(findings),
          missingFields: findings.flatMap((finding) => finding.missingFields),
          findings,
          evidenceRefs: [`assen://audit/${args.subjectType}/${args.subjectId}`],
          nextActions:
            overallResult(findings) === "pass"
              ? ["document.previewで書類プレビューを確認してください"]
              : ["専門家（社労士・弁護士）にご相談ください。findingsの内容を確認し、不足事項を解消してください"],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "compliance.evaluateに失敗しました / compliance.evaluate failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("法令遵守判定に失敗しました / Failed to evaluate compliance");
      }
    },
  );
}

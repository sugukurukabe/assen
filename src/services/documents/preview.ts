/**
 * document.previewの中核処理：生成前プレビュー（差込値・出典・充足状況）。DBを変更しない読み取り専用。
 * docTypeはdoc-type-registry.tsで解決する
 * Core logic for document.preview: pre-generation preview (merged values, provenance, completeness). Read-only, never mutates the DB.
 * docType is resolved via doc-type-registry.ts
 * Logika inti document.preview: preview sebelum generate (nilai gabungan, provenance, kelengkapan). Read-only, tidak pernah mengubah DB.
 * docType diresolusikan via doc-type-registry.ts
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { dispatchAssignments } from "../../db/schema/ledgers.js";
import { renderTemplate } from "./render-template.js";
import { getDocTypeDefinition } from "./doc-type-registry.js";
import { evaluateSubjectCompliance } from "../rules/evaluate-subject.js";
import { UserInputError } from "../../lib/errors.js";

type Db = NodePgDatabase<typeof schema>;

export interface PreviewInput {
  tenantId: string;
  docType: string;
  dispatchAssignmentId: string;
}

export interface PreviewResult {
  renderedText: string;
  findings: Awaited<ReturnType<typeof evaluateSubjectCompliance>>;
}

export async function previewDocument(db: Db, input: PreviewInput): Promise<PreviewResult> {
  const docTypeDefinition = getDocTypeDefinition(input.docType);
  if (!docTypeDefinition) {
    throw new UserInputError(
      `未対応のdocTypeです / Unsupported docType: ${input.docType}`,
      `対応済みのdocType一覧はdocs/document-catalog.mdを参照してください / See docs/document-catalog.md for supported docTypes`,
    );
  }

  const [assignment] = await db.select().from(dispatchAssignments).where(eq(dispatchAssignments.id, input.dispatchAssignmentId));
  if (!assignment) {
    throw new UserInputError(
      `dispatch_assignment ${input.dispatchAssignmentId} が見つかりません / dispatch_assignment ${input.dispatchAssignmentId} not found`,
      "dispatchAssignmentIdを確認してください / Please verify dispatchAssignmentId",
    );
  }

  const renderedText = renderTemplate(
    docTypeDefinition.templateFileName,
    (assignment.conditionsTyped as Record<string, unknown>) ?? {},
  ).toString("utf8");

  const findings = await evaluateSubjectCompliance(db, {
    tenantId: input.tenantId,
    subjectType: docTypeDefinition.subjectType,
    subjectId: input.dispatchAssignmentId,
    mappingFileName: docTypeDefinition.mappingFileName,
    row: assignment,
  });

  return { renderedText, findings };
}

/**
 * 後方互換ラッパー（M1スコープ） / Backward-compatible wrapper (M1 scope) / Wrapper yang kompatibel ke belakang (lingkup M1)
 */
export async function previewLaborConditionsNotice(db: Db, input: Omit<PreviewInput, "docType">): Promise<PreviewResult> {
  return previewDocument(db, { ...input, docType: "labor_conditions_notice" });
}

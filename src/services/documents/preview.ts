/**
 * document.previewの中核処理：生成前プレビュー（差込値・出典・充足状況）。DBを変更しない読み取り専用。
 * docTypeはdoc-type-registry.tsで解決し、subject行はそのsubjectType（dispatch_assignment／job_order_referral）に
 * 応じてsubject-lookup.tsから取得する
 *
 * Core logic for document.preview: pre-generation preview (merged values, provenance, completeness).
 * Read-only, never mutates the DB. docType is resolved via doc-type-registry.ts; the subject row is
 * fetched via subject-lookup.ts according to its subjectType (dispatch_assignment or job_order_referral)
 *
 * Logika inti document.preview: preview sebelum generate (nilai gabungan, provenance, kelengkapan).
 * Read-only, tidak pernah mengubah DB. docType diresolusikan via doc-type-registry.ts; baris subjek
 * diambil via subject-lookup.ts sesuai subjectType-nya (dispatch_assignment atau job_order_referral)
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { renderTemplate } from "./render-template.js";
import { getDocTypeDefinition } from "./doc-type-registry.js";
import { buildSubjectRenderValues } from "./subject-values.js";
import { loadSubjectRow } from "../rules/subject-lookup.js";
import { evaluateSubjectCompliance } from "../rules/evaluate-subject.js";
import { UserInputError } from "../../lib/errors.js";

type Db = NodePgDatabase<typeof schema>;

export interface PreviewInput {
  tenantId: string;
  docType: string;
  // 判定対象のID（dispatch_assignment.id または job_order_referral.id、docTypeのsubjectTypeで決まる）
  // Target subject id (dispatch_assignment.id or job_order_referral.id, decided by the docType's subjectType)
  // ID subjek target (dispatch_assignment.id atau job_order_referral.id, ditentukan oleh subjectType docType)
  subjectId: string;
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

  const subjectRow = await loadSubjectRow(db, docTypeDefinition.subjectType, input.subjectId);
  if (!subjectRow) {
    throw new UserInputError(
      `${docTypeDefinition.subjectType} ${input.subjectId} が見つかりません / ${docTypeDefinition.subjectType} ${input.subjectId} not found`,
      "subjectIdを確認してください / Please verify subjectId",
    );
  }

  const values = buildSubjectRenderValues(docTypeDefinition, subjectRow);
  const renderedText = renderTemplate(docTypeDefinition.templateFileName, values).toString("utf8");

  const findings = await evaluateSubjectCompliance(db, {
    tenantId: input.tenantId,
    subjectType: docTypeDefinition.subjectType,
    subjectId: input.subjectId,
    mappingFileName: docTypeDefinition.mappingFileName,
    row: subjectRow,
  });

  return { renderedText, findings };
}

/**
 * 後方互換ラッパー（M1スコープ） / Backward-compatible wrapper (M1 scope) / Wrapper yang kompatibel ke belakang (lingkup M1)
 */
export async function previewLaborConditionsNotice(db: Db, input: Omit<PreviewInput, "docType">): Promise<PreviewResult> {
  return previewDocument(db, { ...input, docType: "labor_conditions_notice" });
}

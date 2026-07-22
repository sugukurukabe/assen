/**
 * document.previewの中核処理：生成前プレビュー（差込値・出典・充足状況）。DBを変更しない読み取り専用
 * Core logic for document.preview: pre-generation preview (merged values, provenance, completeness). Read-only, never mutates the DB
 * Logika inti document.preview: preview sebelum generate (nilai gabungan, provenance, kelengkapan). Read-only, tidak pernah mengubah DB
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { dispatchAssignments } from "../../db/schema/ledgers.js";
import { renderTemplate } from "./render-template.js";
import { evaluateSubjectCompliance } from "../rules/evaluate-subject.js";
import { UserInputError } from "../../lib/errors.js";

type Db = NodePgDatabase<typeof schema>;

export interface PreviewInput {
  tenantId: string;
  dispatchAssignmentId: string;
}

export interface PreviewResult {
  renderedText: string;
  findings: Awaited<ReturnType<typeof evaluateSubjectCompliance>>;
}

export async function previewLaborConditionsNotice(db: Db, input: PreviewInput): Promise<PreviewResult> {
  const [assignment] = await db.select().from(dispatchAssignments).where(eq(dispatchAssignments.id, input.dispatchAssignmentId));
  if (!assignment) {
    throw new UserInputError(
      `dispatch_assignment ${input.dispatchAssignmentId} が見つかりません / dispatch_assignment ${input.dispatchAssignmentId} not found`,
      "dispatchAssignmentIdを確認してください / Please verify dispatchAssignmentId",
    );
  }

  const renderedText = renderTemplate(
    "labor-conditions-notice.v1.txt",
    (assignment.conditionsTyped as Record<string, unknown>) ?? {},
  ).toString("utf8");

  const findings = await evaluateSubjectCompliance(db, {
    tenantId: input.tenantId,
    subjectType: "dispatch_assignment",
    subjectId: input.dispatchAssignmentId,
    mappingFileName: "labor-conditions-notice.json",
    row: assignment,
  });

  return { renderedText, findings };
}

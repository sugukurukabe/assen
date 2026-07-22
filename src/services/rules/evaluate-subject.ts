/**
 * 決定論的ルールエンジン（§6）。LLMは介在しない。fact_assertionsの矛盾・低confidence・
 * 必須項目欠落を検出し、5値（pass/fail/incomplete/ambiguous/expert_review_required）で返す
 * Deterministic rule engine (§6). No LLM involvement. Detects fact_assertions conflicts, low confidence,
 * and missing required fields, returning the 5-value result (pass/fail/incomplete/ambiguous/expert_review_required)
 * Rule engine deterministik (§6). Tanpa keterlibatan LLM. Mendeteksi konflik fact_assertions, confidence rendah,
 * dan field wajib yang kosong, mengembalikan hasil 5 nilai (pass/fail/incomplete/ambiguous/expert_review_required)
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { factAssertions } from "../../db/schema/evidence.js";
import { findMissingRequiredColumns, loadMapping, type MappingFile } from "./legal-mapping-loader.js";
import type { Finding } from "./five-value-result.js";

type Db = NodePgDatabase<typeof schema>;

const LOW_CONFIDENCE_THRESHOLD = 0.7;

export interface EvaluateSubjectInput {
  tenantId: string;
  subjectType: string;
  subjectId: string;
  mappingFileName: string;
  row: Record<string, unknown>;
}

/**
 * 必須項目の欠落チェック。1件以上欠落していればincomplete findingを返す
 * Checks for missing required fields. Returns an incomplete finding when one or more are missing
 * Memeriksa field wajib yang kosong. Mengembalikan finding incomplete jika satu atau lebih kosong
 */
function checkRequiredFieldCompleteness(mapping: MappingFile, row: Record<string, unknown>): Finding[] {
  const missing = findMissingRequiredColumns(mapping, row);
  if (missing.length === 0) {
    return [];
  }
  return [
    {
      ruleKey: `${mapping.docType}.required_fields`,
      result: "incomplete",
      severity: "blocking",
      message: `法定必須項目が未入力です / Required legal fields are missing: ${missing.join(", ")}`,
      missingFields: missing,
    },
  ];
}

/**
 * fact_assertionsの矛盾（同一field_pathで異なるverified値）と低confidenceを検出する
 * Detects fact_assertions conflicts (different verified values for the same field_path) and low confidence
 * Mendeteksi konflik fact_assertions (nilai verified berbeda untuk field_path yang sama) dan confidence rendah
 */
async function checkFactAssertionHealth(db: Db, subjectType: string, subjectId: string): Promise<Finding[]> {
  const assertions = await db
    .select()
    .from(factAssertions)
    .where(eq(factAssertions.subjectId, subjectId));

  const relevant = assertions.filter((assertion) => assertion.subjectType === subjectType);
  const findings: Finding[] = [];
  const byField = new Map<string, typeof relevant>();

  for (const assertion of relevant) {
    const group = byField.get(assertion.fieldPath) ?? [];
    group.push(assertion);
    byField.set(assertion.fieldPath, group);
  }

  for (const [fieldPath, group] of byField) {
    const verified = group.filter((assertion) => assertion.verificationStatus === "verified");
    const distinctVerifiedValues = new Set(verified.map((assertion) => JSON.stringify(assertion.candidateValue)));

    if (distinctVerifiedValues.size > 1) {
      findings.push({
        ruleKey: "fact_assertions.conflict",
        result: "ambiguous",
        severity: "blocking",
        message: `項目「${fieldPath}」で検証済みの値が複数資料間で矛盾しています / Field "${fieldPath}" has conflicting verified values across sources`,
        missingFields: [],
      });
      continue;
    }

    if (verified.length === 0) {
      const lowConfidenceUnverified = group.filter(
        (assertion) => assertion.verificationStatus === "unverified" && Number(assertion.confidence) < LOW_CONFIDENCE_THRESHOLD,
      );
      if (lowConfidenceUnverified.length > 0) {
        findings.push({
          ruleKey: "fact_assertions.low_confidence",
          result: "expert_review_required",
          severity: "blocking",
          message: `項目「${fieldPath}」の抽出信頼度が閾値未満で、未検証です / Field "${fieldPath}" has extraction confidence below threshold and is unverified`,
          missingFields: [],
        });
      }
    }
  }

  return findings;
}

export async function evaluateSubjectCompliance(db: Db, input: EvaluateSubjectInput): Promise<Finding[]> {
  const mapping = loadMapping(input.mappingFileName);
  const completenessFindings = checkRequiredFieldCompleteness(mapping, input.row);
  const factHealthFindings = await checkFactAssertionHealth(db, input.subjectType, input.subjectId);
  return [...completenessFindings, ...factHealthFindings];
}

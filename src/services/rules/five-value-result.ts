/**
 * rule_resultの5値化（§3.1）。ambiguous/expert_review_requiredはコードレベルでpassへの変換を禁止する
 * The 5-value rule_result (§3.1). ambiguous/expert_review_required can never be converted to pass at the code level
 * rule_result 5 nilai (§3.1). ambiguous/expert_review_required tidak pernah dapat diubah menjadi pass di level kode
 */
import { ExpertReviewRequiredError } from "../../lib/errors.js";

export const RULE_RESULTS = ["pass", "fail", "incomplete", "ambiguous", "expert_review_required"] as const;
export type RuleResult = (typeof RULE_RESULTS)[number];

export interface Finding {
  ruleKey: string;
  result: RuleResult;
  severity: "info" | "warning" | "blocking";
  message: string;
  missingFields: string[];
}

const BLOCKING_RESULTS: ReadonlySet<RuleResult> = new Set(["ambiguous", "expert_review_required"]);

/**
 * findingsの中にambiguous/expert_review_requiredが1件でもあれば書類確定をブロックする。
 * この関数以外の経路でpassへ書き換えることはコード上できない（呼び出し必須のゲート）
 * Blocks document finalization if any finding is ambiguous/expert_review_required.
 * There is no code path other than this function that can rewrite the result to pass (a mandatory gate)
 * Memblokir finalisasi dokumen jika ada finding ambiguous/expert_review_required.
 * Tidak ada jalur kode selain fungsi ini yang dapat menulis ulang hasil menjadi pass (gate wajib)
 */
export function assertNoBlockingFindings(findings: readonly Finding[]): void {
  const blocking = findings.filter((finding) => BLOCKING_RESULTS.has(finding.result));
  if (blocking.length > 0) {
    const summary = blocking.map((finding) => `${finding.ruleKey}: ${finding.message}`).join(" / ");
    throw new ExpertReviewRequiredError(
      `専門家（社労士・弁護士）にご相談ください。未解決の判定があります: ${summary} / Please consult a certified professional (labor/social insurance attorney). Unresolved findings: ${summary}`,
    );
  }
}

export function overallResult(findings: readonly Finding[]): RuleResult {
  if (findings.some((finding) => finding.result === "expert_review_required")) {
    return "expert_review_required";
  }
  if (findings.some((finding) => finding.result === "ambiguous")) {
    return "ambiguous";
  }
  if (findings.some((finding) => finding.result === "fail")) {
    return "fail";
  }
  if (findings.some((finding) => finding.result === "incomplete")) {
    return "incomplete";
  }
  return "pass";
}

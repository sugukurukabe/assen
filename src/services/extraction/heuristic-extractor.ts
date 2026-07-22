/**
 * ヒューリスティック抽出器（既定実装）。求人メールの日本語ラベル（職種：等）を正規表現で抽出する。
 * LLM_API_KEYが設定された際はこのインターフェースの下でLLM実装に差し替える（extraction層のみがLLMを担当し、法令判定には介在しない §6）
 * Heuristic extractor (default implementation). Extracts Japanese labels (occupation:, etc.) from job-order emails via regex.
 * Swap in an LLM implementation behind this interface once LLM_API_KEY is configured (only the extraction layer touches an LLM; it never performs legal judgement, §6)
 * Extractor heuristik (implementasi default). Mengekstrak label Jepang (occupation:, dll.) dari email lowongan via regex.
 * Ganti dengan implementasi LLM di balik interface ini setelah LLM_API_KEY dikonfigurasi (hanya lapisan ekstraksi yang menyentuh LLM; tidak pernah melakukan penilaian hukum, §6)
 */
import type { CandidateFact, ExtractionResult, Extractor } from "./types.js";

interface FieldPattern {
  fieldPath: string;
  pattern: RegExp;
  parse: (match: RegExpMatchArray) => unknown;
}

const FIELD_PATTERNS: FieldPattern[] = [
  { fieldPath: "occupation", pattern: /職種[：:]\s*(.+)/, parse: (m) => m[1]?.trim() },
  { fieldPath: "workLocation", pattern: /就業場所[：:]\s*(.+)/, parse: (m) => m[1]?.trim() },
  { fieldPath: "headcount", pattern: /求人数[：:]\s*(\d+)\s*名?/, parse: (m) => Number(m[1]) },
  {
    fieldPath: "employmentPeriodType",
    pattern: /雇用形態[：:]\s*(無期|有期)/,
    parse: (m) => (m[1] === "無期" ? "indefinite" : "fixed"),
  },
  {
    fieldPath: "wageUnit",
    pattern: /賃金[：:]\s*(時給|日給|月給|年俸)/,
    parse: (m) => ({ 時給: "hour", 日給: "day", 月給: "month", 年俸: "year" }[m[1] as string]),
  },
  {
    fieldPath: "wageAmountMin",
    pattern: /賃金[：:]\s*(?:時給|日給|月給|年俸)?\s*([\d,]+)\s*円/,
    parse: (m) => Number((m[1] ?? "").replace(/,/g, "")),
  },
  {
    fieldPath: "wageAmountMax",
    pattern: /賃金[：:]\s*(?:時給|日給|月給|年俸)?\s*[\d,]+\s*円\s*[〜~-]\s*([\d,]+)\s*円/,
    parse: (m) => Number((m[1] ?? "").replace(/,/g, "")),
  },
  {
    fieldPath: "validUntil",
    pattern: /有効期限[：:]\s*(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/,
    parse: (m) => `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`,
  },
];

const MATCHED_CONFIDENCE = 0.9;

export class HeuristicExtractor implements Extractor {
  async extract(sourceText: string, requiredFieldPaths: readonly string[]): Promise<ExtractionResult> {
    const facts: CandidateFact[] = [];
    const foundFieldPaths = new Set<string>();

    for (const field of FIELD_PATTERNS) {
      const match = sourceText.match(field.pattern);
      if (!match) {
        continue;
      }
      const value = field.parse(match);
      if (value === undefined || value === null || Number.isNaN(value)) {
        continue;
      }
      facts.push({
        fieldPath: field.fieldPath,
        candidateValue: value,
        sourceLocator: `regex:${field.fieldPath}@${match.index ?? -1}`,
        confidence: MATCHED_CONFIDENCE,
      });
      foundFieldPaths.add(field.fieldPath);
    }

    const missingFields = requiredFieldPaths.filter((fieldPath) => !foundFieldPaths.has(fieldPath));

    return Promise.resolve({
      extractionMethod: "heuristic_regex_v1",
      modelVersion: "heuristic-regex-v1",
      facts,
      missingFields,
    });
  }
}

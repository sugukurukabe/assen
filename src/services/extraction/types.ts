/**
 * LLM抽出（および将来のLLM実装）が返す候補事実の共通形式
 * Common shape for candidate facts returned by the extraction stage (including a future LLM implementation)
 * Bentuk umum untuk kandidat fakta yang dikembalikan oleh tahap ekstraksi (termasuk implementasi LLM di masa depan)
 */
export interface CandidateFact {
  fieldPath: string;
  candidateValue: unknown;
  sourceLocator: string;
  confidence: number;
}

export interface ExtractionResult {
  extractionMethod: string;
  modelVersion: string;
  facts: CandidateFact[];
  missingFields: string[];
}

export interface Extractor {
  extract(sourceText: string, requiredFieldPaths: readonly string[]): Promise<ExtractionResult>;
}

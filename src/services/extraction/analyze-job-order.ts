/**
 * job_order.analyzeの中核処理：原文の不変保存＋候補事実の抽出＋欠落列挙。DB確定（job_orders作成）は行わない（§7）
 * Core logic for job_order.analyze: immutable source storage + candidate fact extraction + missing-field listing. Never creates job_orders (§7)
 * Logika inti job_order.analyze: penyimpanan sumber tidak berubah + ekstraksi kandidat fakta + daftar field kosong. Tidak pernah membuat job_orders (§7)
 */
import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { factAssertions, sourceArtifacts } from "../../db/schema/evidence.js";
import { putImmutableObject } from "../../lib/storage.js";
import { HeuristicExtractor } from "./heuristic-extractor.js";
import type { Extractor } from "./types.js";
import { loadMapping } from "../rules/legal-mapping-loader.js";

type Db = NodePgDatabase<typeof schema>;

export interface AnalyzeJobOrderInput {
  tenantId: string;
  sourceText: string;
  sourceUri: string;
  receivedAt?: Date;
}

export interface AnalyzeJobOrderResult {
  sourceArtifactId: string;
  contentHash: string;
  facts: Array<{ fieldPath: string; candidateValue: unknown; confidence: number; sourceLocator: string }>;
  missingFields: string[];
}

const HEURISTIC_FIELD_PATHS = [
  "occupation",
  "workLocation",
  "headcount",
  "employmentPeriodType",
  "wageUnit",
  "wageAmountMin",
  "wageAmountMax",
  "validUntil",
] as const;

let extractorOverride: Extractor | undefined;

/** テスト用に抽出器を差し替える / Swaps the extractor for tests / Mengganti extractor untuk test */
export function setExtractorForTesting(extractor: Extractor | undefined): void {
  extractorOverride = extractor;
}

export async function analyzeJobOrder(db: Db, input: AnalyzeJobOrderInput): Promise<AnalyzeJobOrderResult> {
  // ①原文の不変保存 / immutable source storage / penyimpanan sumber yang tidak berubah
  const bodyBytes = Buffer.from(input.sourceText, "utf8");
  const { objectUri, sha256 } = await putImmutableObject("source-artifacts", bodyBytes, "text/plain; charset=utf-8");

  const sourceArtifactId = randomUUID();
  await db.insert(sourceArtifacts).values({
    id: sourceArtifactId,
    tenantId: input.tenantId,
    sourceType: "email",
    sourceUri: input.sourceUri,
    receivedAt: input.receivedAt ?? new Date(),
    contentHash: sha256,
    immutableObjectUri: objectUri,
  });

  // ②LLMによる候補事実の抽出（extraction層のみ。法令判定には介在しない） / candidate fact extraction (extraction layer only; never legal judgement) / ekstraksi kandidat fakta (hanya lapisan ekstraksi; tidak pernah penilaian hukum)
  const extractor = extractorOverride ?? new HeuristicExtractor();
  const jobOrderMapping = loadMapping("job-order-ledger.json");
  const requiredFieldPaths = HEURISTIC_FIELD_PATHS.filter((fieldPath) =>
    jobOrderMapping.items.some((item) => item.dbColumn.split(",").includes(fieldPath) && !item.optional),
  );
  const extraction = await extractor.extract(input.sourceText, requiredFieldPaths);

  for (const fact of extraction.facts) {
    await db.insert(factAssertions).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      subjectType: "job_order_draft",
      subjectId: sourceArtifactId,
      fieldPath: fact.fieldPath,
      candidateValue: fact.candidateValue,
      sourceArtifactId,
      sourceLocator: fact.sourceLocator,
      extractionMethod: extraction.extractionMethod,
      modelVersion: extraction.modelVersion,
      confidence: fact.confidence.toFixed(3),
      verificationStatus: "unverified",
    });
  }

  return {
    sourceArtifactId,
    contentHash: sha256,
    facts: extraction.facts,
    missingFields: extraction.missingFields,
  };
}

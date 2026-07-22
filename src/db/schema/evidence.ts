/**
 * 証拠層（§4.4）：原文の不変保存とLLM抽出候補事実。法令判定にはLLMを介在させない
 * Evidence layer (§4.4): immutable source storage and LLM-extracted candidate facts. LLM never performs legal judgement
 * Lapisan bukti (§4.4): penyimpanan sumber yang tidak berubah dan kandidat fakta hasil ekstraksi LLM. LLM tidak pernah melakukan penilaian hukum
 */
import { jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, tenantIdColumn } from "./common.js";

export const sourceTypeEnum = pgEnum("source_type", ["email", "pdf", "slack_post", "manual"]);

export const sourceArtifacts = pgTable("source_artifacts", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceUri: text("source_uri").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  contentHash: text("content_hash").notNull(),
  // 本文・添付そのものの不変コピー（GCS/MinIOのオブジェクトキー） / Immutable copy of the body/attachment itself (object storage key) / Kopi tidak berubah dari isi/lampiran itu sendiri (kunci object storage)
  immutableObjectUri: text("immutable_object_uri").notNull(),
  piiClassification: text("pii_classification"),
  createdAt: createdAtColumn(),
});

export const verificationStatusEnum = pgEnum("verification_status", ["unverified", "verified", "rejected"]);

export const factAssertions = pgTable("fact_assertions", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  fieldPath: text("field_path").notNull(),
  candidateValue: jsonb("candidate_value").notNull(),
  sourceArtifactId: uuid("source_artifact_id")
    .notNull()
    .references(() => sourceArtifacts.id),
  // 原文のどこから抽出したか（行番号・文字位置等） / Where in the source this was extracted from (line/char offset etc.) / Dari mana dalam sumber ini diekstrak (baris/offset karakter dll.)
  sourceLocator: text("source_locator"),
  extractionMethod: text("extraction_method").notNull(),
  modelVersion: text("model_version").notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  verificationStatus: verificationStatusEnum("verification_status").notNull().default("unverified"),
  // 認証主体から導出。ツール入力からは受け取らない / Derived from the authenticated principal. Never accepted from tool input / Diturunkan dari principal terautentikasi. Tidak pernah diterima dari input tool
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
});

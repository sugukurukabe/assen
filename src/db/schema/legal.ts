/**
 * 法令層（§4.5）：版管理されたルール・証拠グラフ。YAMLではなくDBで版を追跡し、過去書類を再現可能にする
 * Legal layer (§4.5): versioned rule/evidence graph. Tracked in the DB (not YAML) so past documents remain reproducible
 * Lapisan hukum (§4.5): graf rule/evidence yang diberi versi. Dilacak di DB (bukan YAML) agar dokumen lama tetap dapat direproduksi
 */
import { date, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, tenantIdColumn } from "./common.js";

export const legalSources = pgTable("legal_sources", {
  id: idColumn(),
  authority: text("authority").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url").notNull(),
  publishedAt: date("published_at").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  sha256: text("sha256").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  supersedesSourceId: uuid("supersedes_source_id"),
  createdAt: createdAtColumn(),
});

export const ruleSeverityEnum = pgEnum("rule_severity", ["info", "warning", "blocking"]);

export const legalRules = pgTable("legal_rules", {
  id: idColumn(),
  ruleKey: text("rule_key").notNull(),
  version: text("version").notNull(),
  legalSourceId: uuid("legal_source_id")
    .notNull()
    .references(() => legalSources.id),
  jurisdiction: text("jurisdiction").notNull(),
  triggerSchema: jsonb("trigger_schema").notNull(),
  requiredFieldsSchema: jsonb("required_fields_schema").notNull(),
  severity: ruleSeverityEnum("severity").notNull(),
  deadlinePolicyId: text("deadline_policy_id"),
  remediation: text("remediation"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  createdAt: createdAtColumn(),
});

export const ruleSetStatusEnum = pgEnum("rule_set_status", ["draft", "approved", "retired"]);

export const ruleSets = pgTable("rule_sets", {
  id: idColumn(),
  version: text("version").notNull().unique(),
  status: ruleSetStatusEnum("status").notNull().default("draft"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  checksum: text("checksum").notNull(),
  createdAt: createdAtColumn(),
});

export const templateVersions = pgTable("template_versions", {
  id: idColumn(),
  docType: text("doc_type").notNull(),
  locale: text("locale").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  ruleSetVersion: text("rule_set_version")
    .notNull()
    .references(() => ruleSets.version),
  templateVersion: text("template_version").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  checksum: text("checksum").notNull(),
  createdAt: createdAtColumn(),
});

export const legalOrInternalEnum = pgEnum("deadline_classification", ["legal", "internal_target"]);

export const deadlinePolicies = pgTable("deadline_policies", {
  id: idColumn(),
  key: text("key").notNull().unique(),
  triggerEvent: text("trigger_event").notNull(),
  // 計算方法の説明（コードは§9の deadline-policies.ts に実装。ここは人間可読な説明のみ） / Description of the calculation (code lives in deadline-policies.ts; this is human-readable only) / Deskripsi kalkulasi (kode ada di deadline-policies.ts; ini hanya untuk dibaca manusia)
  calculationMethod: text("calculation_method").notNull(),
  legalOrInternal: legalOrInternalEnum("legal_or_internal").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  createdAt: createdAtColumn(),
});

export const deadlineInstances = pgTable("deadline_instances", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  policyKey: text("policy_key")
    .notNull()
    .references(() => deadlinePolicies.key),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  dueDate: date("due_date").notNull(),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  createdAt: createdAtColumn(),
});

export const evidenceTypeEnum = pgEnum("obligation_evidence_type", ["document", "ledger_row", "artifact"]);

export const obligationEvidence = pgTable("obligation_evidence", {
  id: idColumn(),
  obligationKey: text("obligation_key").notNull(),
  subjectId: text("subject_id").notNull(),
  evidenceType: evidenceTypeEnum("evidence_type").notNull(),
  evidenceRef: text("evidence_ref").notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull(),
  acquiredFrom: text("acquired_from").notNull(),
  createdAt: createdAtColumn(),
});

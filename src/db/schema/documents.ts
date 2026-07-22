/**
 * documents（§5）：単一statusを5系統に分解した状態機械。遷移はすべてaudit_eventsに記録する
 * documents (§5): a state machine split into five independent status tracks. Every transition is recorded in audit_events
 * documents (§5): mesin status yang dipecah menjadi lima jalur independen. Setiap transisi dicatat di audit_events
 */
import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, tenantIdColumn, updatedAtColumn } from "./common.js";

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "under_review",
  "approved",
  "superseded",
  "voided",
]);
export const executionStatusEnum = pgEnum("execution_status", ["unsigned", "partially_signed", "executed"]);
export const deliveryStatusEnum = pgEnum("delivery_status", ["not_sent", "queued", "sent", "delivered", "failed"]);
export const ledgerStatusEnum = pgEnum("ledger_status", ["unposted", "posted", "corrected"]);
export const retentionStatusEnum = pgEnum("retention_status", [
  "active",
  "eligible_for_deletion",
  "legal_hold",
  "deleted",
]);

export const documents = pgTable("documents", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  // 論理文書ID：訂正版発行(document.supersede)を跨いで同一書類を束ねる / Logical document id spanning corrected versions issued via document.supersede / ID dokumen logis yang merangkum versi yang dikoreksi via document.supersede
  logicalDocumentId: text("logical_document_id").notNull(),
  version: integer("version").notNull(),
  docType: text("doc_type").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  templateVersion: text("template_version").notNull(),
  ruleSetVersion: text("rule_set_version").notNull(),
  // 入力スナップショットhash（差込値の再現性を保証） / Hash of the input snapshot (guarantees reproducibility of merged values) / Hash snapshot input (menjamin reproduktifitas nilai yang digabungkan)
  inputSnapshotHash: text("input_snapshot_hash").notNull(),
  generatedObjectUri: text("generated_object_uri"),
  generatedSha256: text("generated_sha256"),
  executedObjectUri: text("executed_object_uri"),
  executedSha256: text("executed_sha256"),
  contentStatus: contentStatusEnum("content_status").notNull().default("draft"),
  executionStatus: executionStatusEnum("execution_status").notNull().default("unsigned"),
  deliveryStatus: deliveryStatusEnum("delivery_status").notNull().default("not_sent"),
  ledgerStatus: ledgerStatusEnum("ledger_status").notNull().default("unposted"),
  retentionStatus: retentionStatusEnum("retention_status").notNull().default("active"),
  supersededByDocumentId: text("superseded_by_document_id"),
  deliveryMeta: jsonb("delivery_meta"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const approvalDecisionEnum = pgEnum("approval_decision", ["approved", "rejected", "expired"]);

export const approvalRequests = pgTable("approval_requests", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  // 承認対象の一意なdocuments行。subject_type/subject_id/versionの組は将来的に重複しうるため、
  // 曖昧なlookupを避けてdocumentIdを正準キーとして直接持つ
  // The single documents row under approval. (subject_type, subject_id, version) can collide in the
  // future, so documentId is stored directly as the canonical key to avoid ambiguous lookups
  // Baris documents tunggal yang sedang disetujui. (subject_type, subject_id, version) berpotensi
  // duplikat di kemudian hari, sehingga documentId disimpan langsung sebagai kunci kanonik
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  subjectVersion: integer("subject_version").notNull(),
  requestedAction: text("requested_action").notNull(),
  // 承認対象PDFのハッシュ。1バイトでも変わればhash不一致で承認は自動void / Hash of the PDF under approval; any byte change auto-voids approval via hash mismatch / Hash PDF yang disetujui; perubahan satu byte pun akan otomatis membatalkan persetujuan via ketidakcocokan hash
  artifactSha256: text("artifact_sha256").notNull(),
  proposedDiff: jsonb("proposed_diff"),
  requiredRole: text("required_role").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  nonce: text("nonce").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // 承認者。OAuth token subject / Slack署名済みpayload / SSO principalから導出。入力からは受け取らない
  // Approver, derived from OAuth token subject / signed Slack payload / SSO principal. Never accepted from input
  // Penyetuju, diturunkan dari OAuth token subject / payload Slack yang ditandatangani / SSO principal. Tidak pernah diterima dari input
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  decision: approvalDecisionEnum("decision"),
  decisionReason: text("decision_reason"),
  createdAt: createdAtColumn(),
});

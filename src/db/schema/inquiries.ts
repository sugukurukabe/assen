/**
 * 問い合わせ（Stage 0）テーブル：正式申込セット受領前の反応者を候補者と分離する
 * Inquiry (Stage 0) table: separates responders from candidates until the formal application set is received
 * Tabel inquiry (Stage 0): memisahkan responden dari kandidat sampai paket pendaftaran resmi diterima
 */
import { boolean, date, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, tenantIdColumn, updatedAtColumn } from "./common.js";

export const applicationChannelEnum = pgEnum("application_channel", [
  "sugukuru_job",
  "win_job",
  "sns_application",
  "other_agency",
  "direct_referral",
  "internal_conversion",
]);

export const inquiryStatusEnum = pgEnum("inquiry_status", [
  "open",
  "set_sent",
  "promoted",
  "closed",
]);

/** Stage 0 問い合わせ（関門手前） / Stage 0 inquiry (before the gate) / Inquiry Stage 0 (sebelum gerbang) */
export const inquiries = pgTable("inquiries", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  // 表示名（暗号化しない軽量メモ。候補者昇格時に帳簿②へ暗号化転記） / Display name (lightweight unencrypted memo; encrypted into Ledger #2 on promote) / Nama tampilan (memo ringan tanpa enkripsi; dienkripsi ke Buku Besar #2 saat promote)
  displayName: text("display_name").notNull(),
  channel: applicationChannelEnum("channel").notNull(),
  status: inquiryStatusEnum("status").notNull().default("open"),
  // DM5問回答（在留資格と期限/居住地/職歴・分野/日本語/希望） / DM 5-question answers / Jawaban 5 pertanyaan DM
  dmAnswers: jsonb("dm_answers").notNull().default({}),
  dmComplete: boolean("dm_complete").notNull().default(false),
  // 正式申込セット受領チェック / Formal application-set receipt checklist / Cek penerimaan paket pendaftaran resmi
  hasApplicationForm: boolean("has_application_form").notNull().default(false),
  hasResume: boolean("has_resume").notNull().default(false),
  hasResidenceCard: boolean("has_residence_card").notNull().default(false),
  hasQualificationDocs: boolean("has_qualification_docs").notNull().default(false),
  hasT2pPriorConsent: boolean("has_t2p_prior_consent").notNull().default(false),
  wantsT2p: boolean("wants_t2p").notNull().default(false),
  setSentAt: timestamp("set_sent_at", { withTimezone: true }),
  setReceivedAt: date("set_received_at"),
  // 7日無応答で自動クローズ判定用 / For 7-day no-response auto-close / Untuk penutupan otomatis 7 hari tanpa respons
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closeReason: text("close_reason"),
  // 昇格後のjob_seekers.id（循環FKを避けるため参照制約なし） / job_seekers.id after promote (no FK to avoid circular refs) / job_seekers.id setelah promote (tanpa FK untuk menghindari referensi sirkular)
  promotedJobSeekerId: uuid("promoted_job_seeker_id"),
  notes: text("notes"),
  extras: jsonb("extras"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

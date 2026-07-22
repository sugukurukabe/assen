/**
 * 法定帳簿テーブル（§4.2）：厚労省記載要領準拠。法定必須項目は型付き列、拡張のみJSONB
 * Statutory ledger tables (§4.2), aligned with MHLW recording guidance. Legally required fields are typed columns; only extensions use JSONB
 * Tabel buku besar wajib (§4.2), selaras dengan panduan pencatatan MHLW. Field yang diwajibkan hukum adalah kolom bertipe; hanya ekstensi memakai JSONB
 */
import { boolean, date, integer, jsonb, numeric, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, tenantIdColumn, updatedAtColumn } from "./common.js";
import { partySnapshots } from "./party-snapshots.js";
import { sourceArtifacts } from "./evidence.js";

export const employmentPeriodTypeEnum = pgEnum("employment_period_type", ["indefinite", "fixed"]);
export const wageUnitEnum = pgEnum("wage_unit", ["hour", "day", "month", "year"]);
export const jobOrderSourceEnum = pgEnum("job_order_source", ["zcareer", "exord", "direct", "sns"]);
export const jobOrderStatusEnum = pgEnum("job_order_status", ["open", "filled", "closed"]);

/** 求人管理簿の正本（帳簿①） / Source of truth for the job-order ledger (Ledger #1) / Sumber kebenaran buku besar lowongan (Buku Besar #1) */
export const jobOrders = pgTable("job_orders", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  companyId: text("company_id").notNull(),
  employerSnapshotId: uuid("employer_snapshot_id")
    .notNull()
    .references(() => partySnapshots.id),
  acceptedAt: date("accepted_at").notNull(),
  validUntil: date("valid_until").notNull(),
  headcount: integer("headcount").notNull(),
  occupation: text("occupation").notNull(),
  workLocation: text("work_location").notNull(),
  employmentPeriodType: employmentPeriodTypeEnum("employment_period_type").notNull(),
  employmentPeriodDetail: text("employment_period_detail"),
  wageAmountMin: numeric("wage_amount_min", { precision: 12, scale: 2 }),
  wageAmountMax: numeric("wage_amount_max", { precision: 12, scale: 2 }),
  wageUnit: wageUnitEnum("wage_unit").notNull(),
  t2pFlag: boolean("t2p_flag").notNull().default(false),
  refundSystem: boolean("refund_system").notNull().default(false),
  source: jobOrderSourceEnum("source").notNull(),
  sourceArtifactId: uuid("source_artifact_id").references(() => sourceArtifacts.id),
  status: jobOrderStatusEnum("status").notNull().default("open"),
  extras: jsonb("extras"),
  retentionUntil: date("retention_until"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const referralOutcomeEnum = pgEnum("referral_outcome", ["hired", "rejected", "withdrawn", "pending"]);
export const referralTypeEnum = pgEnum("referral_type", ["t2p", "pure", "direct"]);
export const referralPhaseEnum = pgEnum("referral_phase", ["F1", "F2", "F3", "F4", "F5", "F6"]);

/** 紹介行：求人×求職の交差＝両帳簿の紹介欄（帳簿①②の接点） / Referral row: intersection of job order x job seeker (junction of Ledgers #1/#2) / Baris rujukan: perpotongan lowongan x pencari kerja (titik temu Buku Besar #1/#2) */
export const jobOrderReferrals = pgTable("job_order_referrals", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  jobOrderId: uuid("job_order_id")
    .notNull()
    .references(() => jobOrders.id),
  jobSeekerId: text("job_seeker_id").notNull(),
  referredAt: date("referred_at").notNull(),
  outcome: referralOutcomeEnum("outcome").notNull().default("pending"),
  hiredAt: date("hired_at"),
  indefiniteEmployment: boolean("indefinite_employment"),
  // 転職勧奨禁止期間（採用日から2年） / No-poaching period (2 years from hire date) / Periode larangan pembajakan (2 tahun dari tanggal perekrutan)
  noPoachingUntil: date("no_poaching_until"),
  earlyLeaveCheckAt: date("early_leave_check_at"),
  earlyLeaveCheckMethod: text("early_leave_check_method"),
  earlyLeaveCheckResult: text("early_leave_check_result"),
  type: referralTypeEnum("type").notNull(),
  phase: referralPhaseEnum("phase"),
  dispatchAssignmentId: uuid("dispatch_assignment_id"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const jobSeekerStatusEnum = pgEnum("job_seeker_status", ["active", "placed", "withdrawn"]);

/** 求職管理簿の正本（帳簿②） / Source of truth for the job-seeker ledger (Ledger #2) / Sumber kebenaran buku besar pencari kerja (Buku Besar #2) */
export const jobSeekers = pgTable("job_seekers", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  staffId: text("staff_id"),
  seekerSnapshotId: uuid("seeker_snapshot_id")
    .notNull()
    .references(() => partySnapshots.id),
  nameEnc: text("name_enc").notNull(),
  addressEnc: text("address_enc").notNull(),
  birthDateEnc: text("birth_date_enc").notNull(),
  desiredOccupation: text("desired_occupation").notNull(),
  acceptedAt: date("accepted_at").notNull(),
  validUntil: date("valid_until").notNull(),
  // 同意日/範囲/提供先 / Consent date/scope/recipient / Tanggal/lingkup/penerima persetujuan
  piiConsent: jsonb("pii_consent").notNull(),
  status: jobSeekerStatusEnum("status").notNull().default("active"),
  extras: jsonb("extras"),
  retentionUntil: date("retention_until"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const feeTypeEnum = pgEnum("fee_type", ["uketsuke", "todokede", "jogen"]);

/** 手数料管理簿の正本（帳簿③） / Source of truth for the fee ledger (Ledger #3) / Sumber kebenaran buku besar biaya (Buku Besar #3) */
export const feeRecords = pgTable("fee_records", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  referralId: uuid("referral_id")
    .notNull()
    .references(() => jobOrderReferrals.id),
  payerSnapshotId: uuid("payer_snapshot_id")
    .notNull()
    .references(() => partySnapshots.id),
  feeType: feeTypeEnum("fee_type").notNull(),
  amountInclTax: numeric("amount_incl_tax", { precision: 12, scale: 2 }).notNull(),
  calcBasisWage: numeric("calc_basis_wage", { precision: 12, scale: 2 }),
  calcBasisRate: numeric("calc_basis_rate", { precision: 6, scale: 4 }),
  // 実際の徴収年月日（請求日ではない） / Actual collection date (not the invoice date) / Tanggal penagihan aktual (bukan tanggal faktur)
  collectedAt: date("collected_at"),
  correctionOf: uuid("correction_of"),
  correctionReason: text("correction_reason"),
  freeeInvoiceRef: text("freee_invoice_ref"),
  retentionUntil: date("retention_until"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/** 派遣就業 / Dispatch assignment / Penugasan dispatch */
export const dispatchAssignments = pgTable("dispatch_assignments", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  staffId: text("staff_id").notNull(),
  companyId: text("company_id").notNull(),
  t2pFlag: boolean("t2p_flag").notNull().default(false),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  orgUnit: text("org_unit"),
  teishokubi: date("teishokubi"),
  // 就業条件明示書の法定項目を型付きで持つ別表 / Typed sub-table for statutory items of the working-conditions notice / Sub-tabel bertipe untuk item wajib dari pemberitahuan kondisi kerja
  conditionsTyped: jsonb("conditions_typed").notNull(),
  extras: jsonb("extras"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/** 派遣元管理台帳の正本（モデル様式22項目を型付きで） / Source of truth for the dispatching-agency ledger (22 model-form items, typed) / Sumber kebenaran buku besar agen dispatch (22 item formulir model, bertipe) */
export const dispatchLedgerEntries = pgTable("dispatch_ledger_entries", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  dispatchAssignmentId: uuid("dispatch_assignment_id")
    .notNull()
    .references(() => dispatchAssignments.id),
  staffId: text("staff_id").notNull(),
  workerSnapshotId: uuid("worker_snapshot_id")
    .notNull()
    .references(() => partySnapshots.id),
  clientSnapshotId: uuid("client_snapshot_id")
    .notNull()
    .references(() => partySnapshots.id),
  kyoteiTaisho: boolean("kyotei_taisho").notNull(),
  mukikoyo: boolean("mukikoyo").notNull(),
  contractPeriod: text("contract_period"),
  over60: boolean("over_60").notNull().default(false),
  clientOffice: text("client_office"),
  clientAddress: text("client_address"),
  orgUnit: text("org_unit"),
  dispatchPeriod: text("dispatch_period"),
  workDays: text("work_days"),
  workHoursStart: text("work_hours_start"),
  workHoursEnd: text("work_hours_end"),
  workDetail: text("work_detail").notNull(),
  responsibilityLevel: text("responsibility_level"),
  t2pFlag: boolean("t2p_flag").notNull().default(false),
  t2pMatters: text("t2p_matters"),
  hakenmotoSekininsha: text("hakenmoto_sekininsha"),
  hakensakiSekininsha: text("hakensaki_sekininsha"),
  overtimeTerms: text("overtime_terms"),
  socialInsurance: jsonb("social_insurance").notNull(),
  kyoikuKunren: jsonb("kyoiku_kunren"),
  careerConsulting: jsonb("career_consulting"),
  koyouAnteiSochi: jsonb("koyou_antei_sochi"),
  complaints: jsonb("complaints"),
  actualVsPlan: jsonb("actual_vs_plan"),
  extras: jsonb("extras"),
  retentionUntil: date("retention_until"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

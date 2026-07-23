/**
 * ④求人条件明示書（職業安定法5条の3）の法定必須項目の型定義。job_order_referrals.conditionsTyped(JSONB)の中身の部分集合を固定する
 * Typed shape of the statutory items in the job-order conditions notice (Employment Security Act Art. 5-3). Fixes a subset of the payload of job_order_referrals.conditionsTyped (JSONB)
 * Bentuk bertipe dari item wajib dalam pemberitahuan ketentuan lowongan (UU Keamanan Kerja Pasal 5-3). Menetapkan subset dari payload job_order_referrals.conditionsTyped (JSONB)
 */
import { z } from "zod";

export const t2pJobOrderNoticeSchema = z.object({
  // 求職者・求人者 / Job seeker and employer / Pencari kerja dan pemberi kerja
  staffName: z.string().min(1),
  clientName: z.string().min(1),
  clientAddress: z.string().min(1),
  clientContact: z.string().optional(),
  // 業務内容・変更の範囲（職安法5条の3第1項1号） / Job duties and change scope (Art. 5-3-1-1) / Uraian tugas dan lingkup perubahan (Pasal 5-3-1-1)
  jobDuties: z.string().min(1),
  jobDutiesChangeScope: z.string().optional(),
  // 就業場所・変更の範囲 / Work location and change scope / Lokasi kerja dan lingkup perubahan
  workLocationT2p: z.string().min(1),
  workLocationChangeScopeT2p: z.string().optional(),
  // 契約期間・更新・試用期間 / Contract period, renewal, probation / Periode kontrak, perpanjangan, percobaan
  contractPeriodTerms: z.string().min(1),
  probationPeriodTerms: z.string().optional(),
  // 就業時間・休日休暇・賃金 / Work hours, days off, wage / Jam kerja, hari libur, upah
  workHoursTerms: z.string().min(1),
  daysOffTerms: z.string().min(1),
  wageDetails: z.string().min(1),
  // 社会保険・受動喫煙防止 / Social insurance, passive-smoking prevention / Asuransi sosial, pencegahan asap rokok pasif
  socialInsuranceEnrollment: z.string().optional(),
  smokingPreventionMeasures: z.string().optional(),
  // 雇用形態（紹介予定派遣を経た直接雇用） / Employment category (T2P conversion) / Kategori kepegawaian (konversi T2P)
  employmentCategoryT2p: z.string().min(1),
  dispatchPeriodStart: z.string().min(1),
  dispatchPeriodEnd: z.string().min(1),
  t2pConversionTiming: z.string().optional(),
  t2pConversionConditions: z.string().min(1),
  t2pNonHireReasonPolicy: z.string().min(1),
  // 寮・通勤・その他 / Dormitory/commute, other / Asrama/transportasi, lainnya
  dormitoryAndCommute: z.string().optional(),
  otherRemarks: z.string().optional(),
  // 明示年月日・方法・担当者 / Disclosure date/method, staff contact / Tanggal/metode pengungkapan, kontak staf
  disclosureDate: z.string().min(1),
  disclosureMethod: z.string().min(1),
  staffContactPerson: z.string().optional(),
});

export type T2pJobOrderNotice = z.infer<typeof t2pJobOrderNoticeSchema>;

export const t2pJobOrderNoticeFieldKeys = Object.keys(t2pJobOrderNoticeSchema.shape);

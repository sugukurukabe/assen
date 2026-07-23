/**
 * ⑤紹介予定派遣に関する説明書 兼 本人同意書（職業安定法5条の3・5条の4）の法定必須項目の型定義。
 * job_order_referrals.conditionsTyped(JSONB)の中身の部分集合を固定する
 *
 * Typed shape of the statutory items in the T2P explanation & consent form (Employment Security Act
 * Art. 5-3, 5-4). Fixes a subset of the payload of job_order_referrals.conditionsTyped (JSONB)
 *
 * Bentuk bertipe dari item wajib dalam formulir penjelasan & persetujuan T2P (UU Keamanan Kerja
 * Pasal 5-3, 5-4). Menetapkan subset dari payload job_order_referrals.conditionsTyped (JSONB)
 */
import { z } from "zod";

export const t2pConsentFormSchema = z.object({
  // 派遣先・業務内容・派遣期間（最長6ヶ月） / Client, job duties, dispatch period (max 6 months) / Klien, uraian tugas, periode dispatch (maks 6 bulan)
  clientName: z.string().min(1),
  jobDuties: z.string().min(1),
  dispatchPeriodStart: z.string().min(1),
  dispatchPeriodEnd: z.string().min(1),
  // 直接雇用への切替予定・転換後の労働条件（別紙④参照） / Planned conversion, post-conversion terms (see attached ④) / Rencana konversi, ketentuan pasca konversi (lihat lampiran ④)
  directEmploymentStartPlan: z.string().min(1),
  // 本人署名情報 / Signatory information / Informasi penandatangan
  consentDate: z.string().min(1),
  seekerFullNameLatin: z.string().min(1),
  explainedBy: z.string().min(1),
  interpreterPresent: z.string().optional(),
  explanationLanguage: z.string().min(1),
});

export type T2pConsentForm = z.infer<typeof t2pConsentFormSchema>;

export const t2pConsentFormFieldKeys = Object.keys(t2pConsentFormSchema.shape);

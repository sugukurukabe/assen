/**
 * ⑦転換条件覚書（労働者派遣個別契約書⑥第2表T-10の詳細を定める覚書）の法定必須項目の型定義。
 * job_order_referrals.conditionsTyped(JSONB)の中身の部分集合を固定する。hired（採用）確定時のみ生成する。
 *
 * Typed shape of the statutory items in the conversion-terms memo (elaborates T-10 of the T2P
 * individual contract ⑥). Fixes a subset of the payload of job_order_referrals.conditionsTyped
 * (JSONB). Generated only when the outcome is hired.
 *
 * Bentuk bertipe dari item wajib dalam memo ketentuan konversi (merinci T-10 kontrak individual T2P
 * ⑥). Menetapkan subset dari payload job_order_referrals.conditionsTyped (JSONB). Dibuat hanya saat
 * hasil adalah diterima kerja.
 */
import { z } from "zod";

export const t2pConversionMemoSchema = z.object({
  // 当事者 / Parties / Pihak
  staffName: z.string().min(1),
  staffNationality: z.string().optional(),
  staffResidenceStatusAndExpiry: z.string().optional(),
  clientName: z.string().min(1),
  clientAddress: z.string().min(1),
  clientRepresentative: z.string().min(1),
  // 転換予定時期・転換後の雇用形態・労働条件 / Conversion timing, post-conversion terms / Waktu konversi, ketentuan pasca konversi
  conversionDate: z.string().min(1),
  postConversionEmploymentType: z.string().min(1),
  postConversionWage: z.string().min(1),
  postConversionWorkLocation: z.string().min(1),
  postConversionOtherTerms: z.string().optional(),
  // 紹介手数料・返金規定・代替紹介特約（T-7・T-10） / Referral fee, refund policy, replacement-referral clause (T-7, T-10) / Biaya rujukan, kebijakan pengembalian, klausul rujukan pengganti (T-7, T-10)
  referralFeeAmount: z.string().min(1),
  feePaymentDueDate: z.string().min(1),
  feePaymentMethod: z.string().min(1),
  refundPolicy: z.string().min(1),
  replacementReferralClause: z.string().optional(),
  // 特定技能外国人の在留手続費用の取扱い（T-8） / Handling of visa-procedure fees for Specified Skilled Workers (T-8) / Penanganan biaya prosedur visa untuk Tenaga Kerja Terampil Khusus (T-8)
  visaProcedureFeeClause: z.string().optional(),
  // 覚書締結日 / Memo execution date / Tanggal penandatanganan memo
  memoDate: z.string().min(1),
});

export type T2pConversionMemo = z.infer<typeof t2pConversionMemoSchema>;

export const t2pConversionMemoFieldKeys = Object.keys(t2pConversionMemoSchema.shape);

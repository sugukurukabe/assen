/**
 * ⑨不採用理由の書面明示（職業安定法5条の3第3項準拠の運用）の法定必須項目の型定義。
 * job_order_referrals.conditionsTyped(JSONB)の中身に加え、rejectionReason（typed column、
 * placement.record_rejection_reasonで記録）を描画時にマージした部分集合を固定する。
 * rejected（不採用）確定かつrejectionReason記録済みの場合のみ生成する。
 *
 * Typed shape of the statutory items in the written notice of a non-hire reason (operational practice
 * under Employment Security Act Art. 5-3-3). Fixes a subset of job_order_referrals.conditionsTyped
 * (JSONB) merged at render time with rejectionReason (a typed column recorded by
 * placement.record_rejection_reason). Generated only once the outcome is rejected and a reason has
 * been recorded.
 *
 * Bentuk bertipe dari item wajib dalam pemberitahuan tertulis alasan tidak diterima (praktik
 * operasional berdasarkan UU Keamanan Kerja Pasal 5-3-3). Menetapkan subset dari
 * job_order_referrals.conditionsTyped (JSONB) yang digabung saat rendering dengan rejectionReason
 * (kolom bertipe yang dicatat oleh placement.record_rejection_reason). Dibuat hanya setelah hasil
 * ditolak dan alasan telah dicatat.
 */
import { z } from "zod";

export const t2pNonHireReasonNoticeSchema = z.object({
  staffName: z.string().min(1),
  clientName: z.string().min(1),
  nonHireCategory: z.string().min(1),
  // placement.record_rejection_reasonで記録されたtyped columnを描画時にマージ / Merged at render time from the typed column recorded by placement.record_rejection_reason / Digabung saat rendering dari kolom bertipe yang dicatat oleh placement.record_rejection_reason
  rejectionReason: z.string().min(1),
  noticeDate: z.string().min(1),
  noticeMethod: z.string().min(1),
});

export type T2pNonHireReasonNotice = z.infer<typeof t2pNonHireReasonNoticeSchema>;

export const t2pNonHireReasonNoticeFieldKeys = Object.keys(t2pNonHireReasonNoticeSchema.shape);

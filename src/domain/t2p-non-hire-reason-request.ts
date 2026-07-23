/**
 * ⑧不採用理由の明示請求書（職業安定法5条の3第3項準拠の運用）の法定必須項目の型定義。
 * job_order_referrals.conditionsTyped(JSONB)の中身の部分集合を固定する。rejected（不採用）確定時のみ生成する。
 *
 * Typed shape of the statutory items in the request for a non-hire reason (operational practice under
 * Employment Security Act Art. 5-3-3). Fixes a subset of the payload of job_order_referrals.conditionsTyped
 * (JSONB). Generated only when the outcome is rejected.
 *
 * Bentuk bertipe dari item wajib dalam permintaan alasan tidak diterima (praktik operasional berdasarkan
 * UU Keamanan Kerja Pasal 5-3-3). Menetapkan subset dari payload job_order_referrals.conditionsTyped
 * (JSONB). Dibuat hanya saat hasil adalah ditolak.
 */
import { z } from "zod";

export const t2pNonHireReasonRequestSchema = z.object({
  documentNumber: z.string().min(1),
  issueDate: z.string().min(1),
  clientName: z.string().min(1),
  clientResponsiblePersonName: z.string().min(1),
  contractDate: z.string().min(1),
  contractNumber: z.string().min(1),
  staffName: z.string().min(1),
  staffManagementNumber: z.string().optional(),
  dispatchPeriodStart: z.string().min(1),
  dispatchPeriodEnd: z.string().min(1),
  nonHireCategory: z.string().min(1),
  replyDueDate: z.string().min(1),
});

export type T2pNonHireReasonRequest = z.infer<typeof t2pNonHireReasonRequestSchema>;

export const t2pNonHireReasonRequestFieldKeys = Object.keys(t2pNonHireReasonRequestSchema.shape);

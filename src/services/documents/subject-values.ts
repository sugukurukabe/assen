/**
 * subjectType別に、書類テンプレへ差し込む値をsubject行から構築する共通ヘルパー。
 * dispatch_assignmentはconditionsTyped(JSONB)のみで自己完結するが、job_order_referralの⑨は
 * rejectionReasonがconditionsTypedではなくtyped columnに記録されるため、描画直前にマージする必要がある
 * （domain/t2p-non-hire-reason-notice.ts参照）。docTypeDefinition.schemaで安全にparseし、
 * 失敗時は未加工の値にフォールバックする（既存M1/M2P1の挙動を保持）
 *
 * Shared helper that builds the values to interpolate into a document template from a subject row,
 * per subjectType. dispatch_assignment is self-contained via conditionsTyped (JSONB) alone, but ⑨ under
 * job_order_referral needs rejectionReason merged in at render time because it is recorded as a typed
 * column, not inside conditionsTyped (see domain/t2p-non-hire-reason-notice.ts). Safely parses through
 * docTypeDefinition.schema, falling back to the raw merged values on failure (preserves existing M1/M2P1
 * behavior)
 *
 * Helper bersama yang membangun nilai untuk disisipkan ke template dokumen dari baris subjek, per
 * subjectType. dispatch_assignment mandiri via conditionsTyped (JSONB) saja, tetapi ⑨ di bawah
 * job_order_referral perlu menggabungkan rejectionReason saat rendering karena dicatat sebagai kolom
 * bertipe, bukan di dalam conditionsTyped (lihat domain/t2p-non-hire-reason-notice.ts). Mem-parse dengan
 * aman melalui docTypeDefinition.schema, kembali ke nilai gabungan mentah jika gagal (mempertahankan
 * perilaku M1/M2P1 yang ada)
 */
import type { DocTypeDefinition } from "./doc-type-registry.js";

/**
 * job_order_referral行のうち、conditionsTyped(JSONB)以外でテンプレに描き込む必要があるtyped column一覧。
 * ⑨（不採用理由の書面明示）のrejectionReasonが該当する
 *
 * job_order_referral typed columns (outside conditionsTyped/JSONB) that must be rendered into a
 * template. Applies to rejectionReason for ⑨ (written notice of non-hire reason)
 *
 * Kolom bertipe job_order_referral (di luar conditionsTyped/JSONB) yang harus dirender ke template.
 * Berlaku untuk rejectionReason untuk ⑨ (pemberitahuan tertulis alasan tidak diterima)
 */
const JOB_ORDER_REFERRAL_TYPED_COLUMN_KEYS = ["rejectionReason"] as const;

export function buildSubjectRenderValues(docTypeDefinition: DocTypeDefinition, row: Record<string, unknown>): Record<string, unknown> {
  const conditionsTyped = (row.conditionsTyped as Record<string, unknown> | null | undefined) ?? {};

  const mergedInput =
    docTypeDefinition.subjectType === "job_order_referral"
      ? {
          ...conditionsTyped,
          ...Object.fromEntries(JOB_ORDER_REFERRAL_TYPED_COLUMN_KEYS.map((key) => [key, row[key] ?? undefined])),
        }
      : conditionsTyped;

  const parsed = docTypeDefinition.schema.safeParse(mergedInput);
  return parsed.success ? (parsed.data as Record<string, unknown>) : mergedInput;
}

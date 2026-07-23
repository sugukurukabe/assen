/**
 * subjectType→DBテーブルの対応集約。document.approveと承認UIの両方から共有する
 * （拡張時：新しいsubjectTypeを追加する際はここへ1箇所追記すればよい）
 *
 * mapping fileの解決は、subjectType単独ではdocType曖昧（dispatch_assignmentはA2/A3/A10/labor_conditions_notice
 * の4docTypeを持ちうる）ため、ここでは行わない。呼び出し側がdocument.docTypeを持っている場合は
 * doc-type-registry.tsのgetDocTypeDefinition()を使うこと（job_orderのようにdocTypeが1つしかないsubjectTypeは
 * job-order-ledger.jsonを直接使ってよい）
 *
 * Centralizes the subjectType -> DB-table lookup, shared by document.approve and the approval UI
 * (when extending: add new subjectTypes here in exactly one place).
 *
 * Mapping-file resolution is intentionally NOT done here, because subjectType alone is ambiguous for docType
 * (dispatch_assignment can back any of A2/A3/A10/labor_conditions_notice). Callers holding a document's docType
 * should use getDocTypeDefinition() in doc-type-registry.ts instead (subjectTypes with exactly one docType, like
 * job_order, may keep using job-order-ledger.json directly)
 *
 * Memusatkan pemetaan subjectType -> tabel DB, dibagikan oleh document.approve dan approval UI
 * (saat memperluas: tambahkan subjectType baru di sini pada satu tempat saja).
 *
 * Resolusi mapping-file sengaja TIDAK dilakukan di sini, karena subjectType saja ambigu untuk docType
 * (dispatch_assignment dapat mendukung salah satu dari A2/A3/A10/labor_conditions_notice). Pemanggil yang
 * memiliki docType dari sebuah document sebaiknya memakai getDocTypeDefinition() di doc-type-registry.ts
 * (subjectType dengan tepat satu docType, seperti job_order, boleh tetap memakai job-order-ledger.json langsung)
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { dispatchAssignments, jobOrderReferrals, jobOrders } from "../../db/schema/ledgers.js";

type Db = NodePgDatabase<typeof schema>;

export const SUBJECT_TYPE_MAPPING_FILE: Record<string, string> = {
  job_order: "job-order-ledger.json",
};

/**
 * subjectType/subjectIdから対応する帳簿行を1件取得する。未対応のsubjectTypeはundefinedを返す
 * Fetches the corresponding ledger row for a subjectType/subjectId. Returns undefined for unsupported subjectTypes
 * Mengambil baris buku besar yang sesuai untuk subjectType/subjectId. Mengembalikan undefined untuk subjectType yang tidak didukung
 */
export async function loadSubjectRow(db: Db, subjectType: string, subjectId: string): Promise<Record<string, unknown> | undefined> {
  if (subjectType === "job_order") {
    const [row] = await db.select().from(jobOrders).where(eq(jobOrders.id, subjectId));
    return row;
  }
  if (subjectType === "dispatch_assignment") {
    const [row] = await db.select().from(dispatchAssignments).where(eq(dispatchAssignments.id, subjectId));
    return row;
  }
  if (subjectType === "job_order_referral") {
    const [row] = await db.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, subjectId));
    return row;
  }
  return undefined;
}

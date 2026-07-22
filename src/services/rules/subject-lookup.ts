/**
 * subjectType→mapping file／DBテーブルの対応集約。document.approveと承認UIの両方から共有する
 * （拡張時：新しいsubjectTypeを追加する際はここへ1箇所追記すればよい）
 * Centralizes the subjectType -> mapping-file / DB-table lookup, shared by document.approve and the approval UI
 * (when extending: add new subjectTypes here in exactly one place)
 * Memusatkan pemetaan subjectType -> mapping-file / tabel DB, dibagikan oleh document.approve dan approval UI
 * (saat memperluas: tambahkan subjectType baru di sini pada satu tempat saja)
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { dispatchAssignments, jobOrders } from "../../db/schema/ledgers.js";

type Db = NodePgDatabase<typeof schema>;

export const SUBJECT_TYPE_MAPPING_FILE: Record<string, string> = {
  job_order: "job-order-ledger.json",
  dispatch_assignment: "labor-conditions-notice.json",
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
  return undefined;
}

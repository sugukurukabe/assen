/**
 * S/A案件リスト照会（スコア等級・ステータスで絞り込み）
 * List job orders filtered by score grade / status
 * Daftar lowongan difilter grade skor / status
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobOrders } from "../../db/schema/ledgers.js";

type Db = NodePgDatabase<typeof schema>;

export interface ListJobOrdersInput {
  grades?: Array<"S" | "A" | "B" | "C">;
  status?: "open" | "filled" | "closed";
  limit?: number;
}

export async function listJobOrders(db: Db, input: ListJobOrdersInput = {}) {
  const limit = Math.min(input.limit ?? 50, 100);
  const conditions = [];
  if (input.grades && input.grades.length > 0) {
    conditions.push(inArray(jobOrders.scoreGrade, input.grades));
  }
  if (input.status) {
    conditions.push(eq(jobOrders.status, input.status));
  }

  const rows = await db
    .select({
      id: jobOrders.id,
      companyId: jobOrders.companyId,
      occupation: jobOrders.occupation,
      jobTitle: jobOrders.jobTitle,
      workLocation: jobOrders.workLocation,
      source: jobOrders.source,
      zcareerJobId: jobOrders.zcareerJobId,
      scoreGrade: jobOrders.scoreGrade,
      scoreTotal: jobOrders.scoreTotal,
      scoreBreakdown: jobOrders.scoreBreakdown,
      supervisorGateResult: jobOrders.supervisorGateResult,
      status: jobOrders.status,
      t2pFlag: jobOrders.t2pFlag,
      acceptedAt: jobOrders.acceptedAt,
    })
    .from(jobOrders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(jobOrders.scoreTotal), desc(jobOrders.acceptedAt))
    .limit(limit);

  return { count: rows.length, jobOrders: rows };
}

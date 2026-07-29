/**
 * 帳簿②の求職者をSlack選択肢用の最小形へ射影する。
 * Projects Ledger #2 job seekers into the minimal shape for Slack options.
 * Memetakan pencari kerja Buku Besar #2 ke bentuk minimal untuk opsi Slack.
 */
import { desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobSeekers } from "../../db/schema/ledgers.js";
import { decryptPii } from "../../lib/pii-crypto.js";
import { clampListLimit, matchesListQuery, toListOptionsResult, type ListOptionsResult } from "./types.js";

type Db = NodePgDatabase<typeof schema>;

export type JobSeekerListStatus = "active" | "closed" | "all";

export interface JobSeekerListInput {
  query?: string;
  status?: JobSeekerListStatus;
  limit?: number;
}

export async function listJobSeekers(db: Db, input: JobSeekerListInput = {}): Promise<ListOptionsResult> {
  const limit = clampListLimit(input.limit);
  const status = input.status ?? "active";
  const rows = await db
    .select({
      id: jobSeekers.id,
      staffId: jobSeekers.staffId,
      nameEnc: jobSeekers.nameEnc,
      status: jobSeekers.status,
    })
    .from(jobSeekers)
    .where(statusCondition(status))
    .orderBy(desc(jobSeekers.updatedAt), desc(jobSeekers.createdAt));

  const filtered = rows
    .map((row) => ({
      id: row.id,
      staffId: row.staffId ?? undefined,
      name: decryptPii(row.nameEnc),
    }))
    .filter((row) => matchesListQuery(input.query, [row.name, row.staffId]));

  const items = filtered.map((row) => ({
    value: row.id,
    label: row.name,
  }));
  return toListOptionsResult(items, filtered.length, limit);
}

function statusCondition(status: JobSeekerListStatus) {
  if (status === "active") {
    return eq(jobSeekers.status, "active");
  }
  if (status === "closed") {
    return inArray(jobSeekers.status, ["placed", "withdrawn"]);
  }
  return undefined;
}

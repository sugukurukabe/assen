/**
 * freee会計の取引先をSlack選択肢用の最小形へ射影する。
 * Projects freee Accounting partners into the minimal shape for Slack options.
 * Memetakan partner freee Accounting ke bentuk minimal untuk opsi Slack.
 */
import { getFreeeDirectory } from "../../integrations/freee/directory.js";
import type { FreeeDirectory, PartnerMasterCandidate } from "../../integrations/freee/types.js";
import { clampListLimit, matchesListQuery, toListOptionsResult, type ListOptionsResult } from "./types.js";

export type PartnerListStatus = "active" | "inactive" | "all";

export interface PartnerListInput {
  query?: string;
  status?: PartnerListStatus;
  limit?: number;
}

export async function listPartners(input: PartnerListInput = {}, directory: FreeeDirectory = getFreeeDirectory()): Promise<ListOptionsResult> {
  const limit = clampListLimit(input.limit);
  const status = input.status ?? "active";
  const filtered = (await directory.listPartnerCandidates()).filter((candidate) => matchesStatus(candidate, status)).filter((candidate) =>
    matchesListQuery(input.query, [candidate.officialName, candidate.nameKana, candidate.shortcut1, candidate.shortcut2]),
  );

  const items = filtered.map((candidate) => ({
    value: candidate.partnerId,
    label: candidate.officialName,
  }));
  return toListOptionsResult(items, filtered.length, limit);
}

function matchesStatus(candidate: PartnerMasterCandidate, status: PartnerListStatus): boolean {
  if (status === "all") {
    return true;
  }
  return status === "active" ? candidate.available : !candidate.available;
}

/**
 * 就業中スタッフ候補をfreee人事労務から取得し、ASSEN staffIdへ射影する。
 * Fetches staff candidates from freee HR and projects them to ASSEN staffId options.
 * Mengambil kandidat staf dari freee HR dan memetakannya ke opsi staffId ASSEN.
 */
import { FreeeIntegrationError } from "../../integrations/freee/types.js";
import { getFreeeDirectory } from "../../integrations/freee/directory.js";
import type { FreeeDirectory, StaffMasterCandidate } from "../../integrations/freee/types.js";
import { clampListLimit, matchesListQuery, toListOptionsResult, type ListOptionsResult } from "./types.js";

export type StaffListStatus = "active" | "retired" | "all";

export interface StaffListInput {
  query?: string;
  status?: StaffListStatus;
  limit?: number;
}

export async function listStaff(input: StaffListInput = {}, directory: FreeeDirectory = getFreeeDirectory()): Promise<ListOptionsResult> {
  const limit = clampListLimit(input.limit);
  const status = input.status ?? "active";
  const filtered = (await directory.listStaffCandidates()).filter((candidate) => matchesStatus(candidate, status)).filter((candidate) =>
    matchesListQuery(input.query, [candidate.displayName, candidate.kana, candidate.employeeNumber, candidate.staffId]),
  );

  const missingMapping = filtered.find((candidate) => !candidate.staffId);
  if (missingMapping) {
    throw new FreeeIntegrationError(
      `freee従業員ID ${missingMapping.freeeEmployeeId} のstaffId対応がありません / Missing staffId mapping for freee employee ${missingMapping.freeeEmployeeId}`,
    );
  }

  const mapped = filtered.filter(hasStaffId);
  const items = mapped.map((candidate) => ({
    value: candidate.staffId,
    label: candidate.displayName,
  }));
  return toListOptionsResult(items, filtered.length, limit);
}

function matchesStatus(candidate: StaffMasterCandidate, status: StaffListStatus): boolean {
  if (status === "all") {
    return true;
  }
  const retired = Boolean(candidate.retireDate);
  return status === "retired" ? retired : !retired;
}

function hasStaffId(candidate: StaffMasterCandidate): candidate is StaffMasterCandidate & { staffId: string } {
  return Boolean(candidate.staffId);
}

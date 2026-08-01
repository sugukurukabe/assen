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
    matchesListQuery(input.query, [candidate.displayName, candidate.employeeNumber, candidate.staffId]),
  );

  // staffIdは Secret上書き ?? freee社員番号(num) で解決済み（CachedFreeeDirectory参照）。
  // ここではnum自体が空で上書きも無い従業員だけを明示エラーにする（空配列にしない）。
  // staffId is already resolved as Secret override ?? freee employee number (num) upstream (see CachedFreeeDirectory).
  // Here we only fail explicitly for employees with neither a num nor an override (never return an empty list silently).
  // staffId sudah diresolusi sebagai override Secret ?? nomor karyawan freee (num) di hulu (lihat CachedFreeeDirectory).
  // Di sini kita hanya gagal secara eksplisit untuk karyawan tanpa num maupun override (tidak pernah diam-diam mengembalikan daftar kosong).
  const missingMapping = filtered.find((candidate) => !candidate.staffId);
  if (missingMapping) {
    throw new FreeeIntegrationError(
      `freee従業員ID ${missingMapping.freeeEmployeeId} の社員番号(num)が空で、staffId対応表の上書きもありません / freee employee ${missingMapping.freeeEmployeeId} has no employee number (num) and no staffId mapping override`,
    );
  }

  const mapped = filtered.filter(hasStaffId);
  assertNoDuplicateStaffIds(mapped);
  const items = mapped.map((candidate) => ({
    value: candidate.staffId,
    label: candidate.displayName,
  }));
  return toListOptionsResult(items, filtered.length, limit);
}

function assertNoDuplicateStaffIds(candidates: Array<StaffMasterCandidate & { staffId: string }>): void {
  const seen = new Map<string, string>();
  for (const candidate of candidates) {
    const previousFreeeEmployeeId = seen.get(candidate.staffId);
    if (previousFreeeEmployeeId) {
      throw new FreeeIntegrationError(
        `staffId ${candidate.staffId} がfreee従業員ID ${previousFreeeEmployeeId} と ${candidate.freeeEmployeeId} で重複しています / Duplicate staffId ${candidate.staffId} for freee employees ${previousFreeeEmployeeId} and ${candidate.freeeEmployeeId}`,
      );
    }
    seen.set(candidate.staffId, candidate.freeeEmployeeId);
  }
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

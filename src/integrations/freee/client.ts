/**
 * freee APIから必要最小限の読み取り候補だけを取得するクライアント。
 * Client that fetches only the minimal read candidates needed from freee APIs.
 * Klien yang mengambil hanya kandidat baca minimal yang dibutuhkan dari API freee.
 */
import { z } from "zod";
import type { AssenEnv } from "../../lib/env.js";
import { FreeeIntegrationError, type PartnerMasterCandidate, type StaffMasterCandidate } from "./types.js";
import type { AccessTokenProvider } from "./secret-manager-store.js";

const employeeSchema = z.object({
  id: z.union([z.number(), z.string()]),
  num: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  retire_date: z.string().nullable().optional(),
});

// freee人事労務の従業員一覧は素の配列を返す（実機で確認済み）。将来ラップ形式に変わっても壊れないよう両方受ける。
// freee HR returns a bare array for the employee list (verified against the live API); accept the wrapped shape too so a future change does not break us.
// freee HR mengembalikan array biasa untuk daftar karyawan (terverifikasi pada API asli); terima juga bentuk terbungkus agar perubahan di masa depan tidak merusak.
const employeesResponseSchema = z.union([
  z.array(employeeSchema),
  z.object({
    employees: z.array(employeeSchema).default([]),
    total_count: z.number().int().nonnegative().optional(),
  }),
]);

const partnerSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  long_name: z.string().nullable().optional(),
  name_kana: z.string().nullable().optional(),
  shortcut1: z.string().nullable().optional(),
  shortcut2: z.string().nullable().optional(),
  available: z.boolean(),
});

const partnersResponseSchema = z.object({
  partners: z.array(partnerSchema).default([]),
});

type FetchLike = typeof fetch;

export class FreeeApiClient {
  constructor(
    private readonly env: Pick<AssenEnv, "FREEE_COMPANY_ID" | "FREEE_HR_BASE_URL" | "FREEE_ACCOUNTING_BASE_URL">,
    private readonly accessTokenProvider: AccessTokenProvider,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async listStaffCandidates(staffIdByFreeeEmployeeId: Map<string, string>): Promise<StaffMasterCandidate[]> {
    const employees = await this.fetchAllEmployees();
    return employees.map((employee) => {
      const freeeEmployeeId = String(employee.id);
      const employeeNumber = employee.num?.trim() || undefined;
      return {
        freeeEmployeeId,
        staffId: staffIdByFreeeEmployeeId.get(freeeEmployeeId) ?? employeeNumber,
        displayName: employee.display_name ?? freeeEmployeeId,
        employeeNumber,
        retireDate: employee.retire_date ?? undefined,
      } satisfies StaffMasterCandidate;
    });
  }

  async listPartnerCandidates(): Promise<PartnerMasterCandidate[]> {
    const url = new URL(`${this.env.FREEE_ACCOUNTING_BASE_URL}/partners`);
    url.searchParams.set("company_id", this.env.FREEE_COMPANY_ID);
    url.searchParams.set("limit", "3000");
    const payload = partnersResponseSchema.parse(await this.fetchJson(url));
    return payload.partners.map((partner) => ({
      partnerId: String(partner.id),
      officialName: partner.long_name || partner.name,
      nameKana: partner.name_kana ?? undefined,
      shortcut1: partner.shortcut1 ?? undefined,
      shortcut2: partner.shortcut2 ?? undefined,
      available: partner.available,
    }));
  }

  private async fetchAllEmployees(): Promise<Array<z.infer<typeof employeeSchema>>> {
    const employees: Array<z.infer<typeof employeeSchema>> = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const url = new URL(`${this.env.FREEE_HR_BASE_URL}/companies/${this.env.FREEE_COMPANY_ID}/employees`);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("with_no_payroll_calculation", "true");
      const payload = employeesResponseSchema.parse(await this.fetchJson(url));
      const page = Array.isArray(payload) ? payload : payload.employees;
      const totalCount = Array.isArray(payload) ? undefined : payload.total_count;
      employees.push(...page);
      offset += page.length;
      if (page.length < limit || (totalCount !== undefined && offset >= totalCount)) {
        return employees;
      }
    }
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const accessToken = await this.accessTokenProvider.getAccessToken();
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new FreeeIntegrationError(`freee API request failed: HTTP ${response.status}`);
    }
    return response.json();
  }
}

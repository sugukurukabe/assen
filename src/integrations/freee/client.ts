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
  employment_type: z.string().nullable().optional(),
});

const employeesResponseSchema = z.object({
  employees: z.array(employeeSchema).default([]),
  total_count: z.number().int().nonnegative().optional(),
});

const employeeProfileRuleSchema = z.object({
  last_name_kana: z.string().nullable().optional(),
  first_name_kana: z.string().nullable().optional(),
  employment_type: z.string().nullable().optional(),
});

const employeeProfileResponseSchema = z.object({
  employee_profile_rule: employeeProfileRuleSchema.optional(),
  profile_rule: employeeProfileRuleSchema.optional(),
});

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
    const profiles = await mapWithConcurrency(employees, 5, async (employee) => {
      const profile = await this.fetchEmployeeProfile(String(employee.id));
      const kana = [profile.last_name_kana, profile.first_name_kana].filter(Boolean).join(" ");
      return {
        freeeEmployeeId: String(employee.id),
        staffId: staffIdByFreeeEmployeeId.get(String(employee.id)),
        displayName: employee.display_name ?? String(employee.id),
        kana: kana || undefined,
        employeeNumber: employee.num ?? undefined,
        retireDate: employee.retire_date ?? undefined,
        employmentType: profile.employment_type ?? employee.employment_type ?? undefined,
      } satisfies StaffMasterCandidate;
    });
    return profiles;
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
      employees.push(...payload.employees);
      offset += payload.employees.length;
      if (payload.employees.length < limit || (payload.total_count !== undefined && offset >= payload.total_count)) {
        return employees;
      }
    }
  }

  private async fetchEmployeeProfile(employeeId: string): Promise<z.infer<typeof employeeProfileRuleSchema>> {
    const url = new URL(`${this.env.FREEE_HR_BASE_URL}/employees/${employeeId}/profile_rule`);
    url.searchParams.set("company_id", this.env.FREEE_COMPANY_ID);
    const payload = employeeProfileResponseSchema.parse(await this.fetchJson(url));
    return payload.employee_profile_rule ?? payload.profile_rule ?? {};
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

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map(mapper))));
  }
  return results;
}

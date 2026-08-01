/**
 * freee OAuth tokenとstaffId対応表をSecret Managerから読み書きする境界。
 * Boundary for reading/writing freee OAuth tokens and staffId mapping in Secret Manager.
 * Batas untuk membaca/menulis token OAuth freee dan pemetaan staffId di Secret Manager.
 */
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { z } from "zod";
import type { AssenEnv } from "../../lib/env.js";
import { FreeeIntegrationError } from "./types.js";

const tokenSecretSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAtEpochSeconds: z.number().int().positive().optional(),
});

const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

const staffMappingEntriesSchema = z.object({
  employees: z.array(
    z.object({
      freeeEmployeeId: z.string().min(1),
      staffId: z.string().min(1),
    }),
  ),
});

// reasonは運用者が後から棚卸しできるようにするための必須メモ（誰が・なぜ外したかが分からない除外表を作らない）
// reason is a required note so operators can audit the list later (never build an exclusion list without a stated reason)
// reason wajib agar operator dapat mengaudit daftar ini nanti (jangan membuat daftar pengecualian tanpa alasan tertulis)
const partnerExclusionEntriesSchema = z.object({
  partners: z.array(
    z.object({
      partnerId: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
});

type FreeeTokenSecret = z.infer<typeof tokenSecretSchema>;

export interface SecretJsonStore {
  readJson(secretName: string): Promise<unknown>;
  addJsonVersion(secretName: string, value: unknown): Promise<void>;
}

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

type FetchLike = typeof fetch;

export class GoogleSecretJsonStore implements SecretJsonStore {
  private readonly client: SecretManagerServiceClient;

  constructor(client = new SecretManagerServiceClient()) {
    this.client = client;
  }

  async readJson(secretName: string): Promise<unknown> {
    const [version] = await this.client.accessSecretVersion({ name: `${secretName}/versions/latest` });
    const payload = version.payload?.data?.toString();
    if (!payload) {
      throw new FreeeIntegrationError("Secret Managerのpayloadが空です / Secret Manager payload is empty");
    }
    return JSON.parse(payload) as unknown;
  }

  async addJsonVersion(secretName: string, value: unknown): Promise<void> {
    await this.client.addSecretVersion({
      parent: secretName,
      payload: { data: Buffer.from(JSON.stringify(value), "utf8") },
    });
  }
}

export class SecretManagerFreeeTokenProvider implements AccessTokenProvider {
  private cachedToken: FreeeTokenSecret | undefined;
  private refreshInFlight: Promise<FreeeTokenSecret> | undefined;

  constructor(
    private readonly env: Pick<AssenEnv, "FREEE_CLIENT_ID" | "FREEE_CLIENT_SECRET" | "FREEE_TOKEN_SECRET_NAME" | "FREEE_TOKEN_URL">,
    private readonly store: SecretJsonStore,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getAccessToken(): Promise<string> {
    const token = await this.resolveToken();
    return token.accessToken;
  }

  private async resolveToken(): Promise<FreeeTokenSecret> {
    if (this.isFresh(this.cachedToken)) {
      return this.cachedToken;
    }
    const storedToken = tokenSecretSchema.parse(await this.store.readJson(this.env.FREEE_TOKEN_SECRET_NAME));
    if (this.isFresh(storedToken)) {
      this.cachedToken = storedToken;
      return storedToken;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshToken(storedToken).finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private isFresh(token: FreeeTokenSecret | undefined): token is FreeeTokenSecret {
    if (!token?.expiresAtEpochSeconds) {
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    return token.expiresAtEpochSeconds - now > 60;
  }

  private async refreshToken(storedToken: FreeeTokenSecret): Promise<FreeeTokenSecret> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.env.FREEE_CLIENT_ID,
      client_secret: this.env.FREEE_CLIENT_SECRET,
      refresh_token: storedToken.refreshToken,
    });

    const response = await this.fetchImpl(this.env.FREEE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const reread = tokenSecretSchema.parse(await this.store.readJson(this.env.FREEE_TOKEN_SECRET_NAME));
      if (this.isFresh(reread)) {
        this.cachedToken = reread;
        return reread;
      }
      throw new FreeeIntegrationError(`freee OAuth token refresh failed: HTTP ${response.status}`);
    }

    const payload = refreshResponseSchema.parse(await response.json());
    const nextToken: FreeeTokenSecret = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + payload.expires_in,
    };
    await this.store.addJsonVersion(this.env.FREEE_TOKEN_SECRET_NAME, nextToken);
    this.cachedToken = nextToken;
    return nextToken;
  }
}

/**
 * 派遣先候補から外すfreee取引先IDの集合を読む（従業員本人・社内メール名などの経理専用取引先）
 * Reads the set of freee partner ids to keep out of dispatch-destination options (accounting-only partners such as employees themselves)
 * Membaca kumpulan id partner freee yang dikecualikan dari opsi tujuan penempatan (partner khusus akuntansi seperti karyawan sendiri)
 */
export async function readPartnerExclusions(store: Pick<SecretJsonStore, "readJson">, secretName: string): Promise<Set<string>> {
  const raw = await store.readJson(secretName);
  const parsed = partnerExclusionEntriesSchema.parse(raw);
  const result = new Set<string>();
  for (const entry of parsed.partners) {
    if (result.has(entry.partnerId)) {
      throw new FreeeIntegrationError(`除外取引先IDが重複しています / Duplicate partner exclusion: ${entry.partnerId}`);
    }
    result.add(entry.partnerId);
  }
  return result;
}

export async function readStaffIdMapping(store: Pick<SecretJsonStore, "readJson">, secretName: string): Promise<Map<string, string>> {
  const raw = await store.readJson(secretName);
  const parsed = staffMappingEntriesSchema.parse(raw);
  const result = new Map<string, string>();
  const usedStaffIds = new Set<string>();
  for (const entry of parsed.employees) {
    if (result.has(entry.freeeEmployeeId)) {
      throw new FreeeIntegrationError(`freee従業員IDの対応が重複しています / Duplicate freee employee mapping: ${entry.freeeEmployeeId}`);
    }
    if (usedStaffIds.has(entry.staffId)) {
      throw new FreeeIntegrationError(`staffIdの対応が重複しています / Duplicate staffId mapping: ${entry.staffId}`);
    }
    result.set(entry.freeeEmployeeId, entry.staffId);
    usedStaffIds.add(entry.staffId);
  }
  return result;
}

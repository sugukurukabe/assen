/**
 * freeeマスタ候補の5分TTLキャッシュ。障害時に古いキャッシュを正常値として返さない。
 * Five-minute TTL cache for freee master candidates. It never returns stale cache as a successful value on failures.
 * Cache TTL lima menit untuk kandidat master freee. Tidak mengembalikan cache lama sebagai nilai sukses saat gagal.
 */
import { assertFreeeConfigured, loadEnv } from "../../lib/env.js";
import { FreeeApiClient } from "./client.js";
import { GoogleSecretJsonStore, readStaffIdMapping, SecretManagerFreeeTokenProvider } from "./secret-manager-store.js";
import type { FreeeDirectory, PartnerMasterCandidate, StaffMasterCandidate } from "./types.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CachedFreeeDirectory implements FreeeDirectory {
  private staffCache: CacheEntry<StaffMasterCandidate[]> | undefined;
  private partnerCache: CacheEntry<PartnerMasterCandidate[]> | undefined;
  private staffInFlight: Promise<StaffMasterCandidate[]> | undefined;
  private partnerInFlight: Promise<PartnerMasterCandidate[]> | undefined;

  constructor(
    private readonly ttlMillis: number,
    private readonly staffMappingSecretName: string,
    private readonly store: { readJson(secretName: string): Promise<unknown> },
    private readonly client: FreeeApiClient,
  ) {}

  async listStaffCandidates(): Promise<StaffMasterCandidate[]> {
    if (this.isFresh(this.staffCache)) {
      return this.staffCache.value;
    }
    if (!this.staffInFlight) {
      this.staffInFlight = this.refreshStaff().finally(() => {
        this.staffInFlight = undefined;
      });
    }
    return this.staffInFlight;
  }

  async listPartnerCandidates(): Promise<PartnerMasterCandidate[]> {
    if (this.isFresh(this.partnerCache)) {
      return this.partnerCache.value;
    }
    if (!this.partnerInFlight) {
      this.partnerInFlight = this.client.listPartnerCandidates().then((value) => {
        this.partnerCache = { value, expiresAt: Date.now() + this.ttlMillis };
        return value;
      }).finally(() => {
        this.partnerInFlight = undefined;
      });
    }
    return this.partnerInFlight;
  }

  private async refreshStaff(): Promise<StaffMasterCandidate[]> {
    const mapping = await readStaffIdMapping(this.store, this.staffMappingSecretName);
    const value = await this.client.listStaffCandidates(mapping);
    this.staffCache = { value, expiresAt: Date.now() + this.ttlMillis };
    return value;
  }

  private isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return entry !== undefined && entry.expiresAt > Date.now();
  }
}

let defaultDirectory: FreeeDirectory | undefined;

export function getFreeeDirectory(): FreeeDirectory {
  if (!defaultDirectory) {
    const env = loadEnv();
    assertFreeeConfigured(env);
    const store = new GoogleSecretJsonStore();
    const tokenProvider = new SecretManagerFreeeTokenProvider(env, store);
    const client = new FreeeApiClient(env, tokenProvider);
    defaultDirectory = new CachedFreeeDirectory(env.FREEE_CACHE_TTL_SECONDS * 1000, env.FREEE_STAFF_ID_MAPPING_SECRET_NAME, store, client);
  }
  return defaultDirectory;
}

export function setFreeeDirectoryForTest(directory: FreeeDirectory | undefined): void {
  defaultDirectory = directory;
}

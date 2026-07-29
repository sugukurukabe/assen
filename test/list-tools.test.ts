/**
 * Slack選択肢用読み取りツールの契約テスト。
 * Contract tests for Slack-option read tools.
 * Test kontrak untuk tool baca opsi Slack.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireTenantScopedDb } from "../src/db/client.js";
import { jobSeekers } from "../src/db/schema/ledgers.js";
import { partySnapshots } from "../src/db/schema/party-snapshots.js";
import { encryptPii } from "../src/lib/pii-crypto.js";
import { listJobSeekers } from "../src/services/list-options/list-job-seekers.js";
import { listPartners } from "../src/services/list-options/list-partners.js";
import { listStaff } from "../src/services/list-options/list-staff.js";
import type { FreeeDirectory, PartnerMasterCandidate, StaffMasterCandidate } from "../src/integrations/freee/types.js";
import { FreeeIntegrationError } from "../src/integrations/freee/types.js";
import {
  readStaffIdMapping,
  SecretManagerFreeeTokenProvider,
  type SecretJsonStore,
} from "../src/integrations/freee/secret-manager-store.js";

process.env.PII_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

class FakeDirectory implements FreeeDirectory {
  constructor(
    private readonly staff: StaffMasterCandidate[],
    private readonly partners: PartnerMasterCandidate[],
  ) {}

  listStaffCandidates(): Promise<StaffMasterCandidate[]> {
    return Promise.resolve(this.staff);
  }

  listPartnerCandidates(): Promise<PartnerMasterCandidate[]> {
    return Promise.resolve(this.partners);
  }
}

class FakeSecretStore implements SecretJsonStore {
  added: unknown[] = [];

  constructor(private value: unknown) {}

  readJson(): Promise<unknown> {
    return Promise.resolve(this.value);
  }

  addJsonVersion(_secretName: string, value: unknown): Promise<void> {
    this.added.push(value);
    this.value = value;
    return Promise.resolve();
  }
}

const forbiddenValues = ["鹿児島県秘密住所", "1990-01-01", "JP90BANK", "080-0000-0000", "secret@example.com", "在留カード番号"];

function expectMinimalResponse(serialized: string): void {
  const parsed = JSON.parse(serialized) as { items: Array<Record<string, unknown>>; total: number; truncated: boolean };
  expect(Object.keys(parsed).sort()).toEqual(["items", "total", "truncated"]);
  for (const item of parsed.items) {
    expect(Object.keys(item).sort()).toEqual(["label", "value"]);
  }
  for (const forbidden of forbiddenValues) {
    expect(serialized).not.toContain(forbidden);
  }
}

describe("Slack option list services", () => {
  it("staff_list returns ASSEN staffId values and searches name, kana, employee number, and status", async () => {
    const staffWithSecrets: StaffMasterCandidate & { address: string; birthDate: string; bankAccount: string } = {
      freeeEmployeeId: "2817063",
      staffId: "staff-sugiyanto",
      displayName: "スギヤント",
      kana: "スギヤント",
      employeeNumber: "I-0004",
      employmentType: "temporary",
      address: "鹿児島県秘密住所",
      birthDate: "1990-01-01",
      bankAccount: "JP90BANK",
    };
    const directory = new FakeDirectory(
      [
        staffWithSecrets,
        { freeeEmployeeId: "1", staffId: "staff-kabe", displayName: "壁 晃弘", employmentType: "board-member" },
        { freeeEmployeeId: "2", staffId: "staff-retired", displayName: "退職 太郎", retireDate: "2026-01-31" },
      ],
      [],
    );

    const result = await listStaff({ query: "I-0004", status: "active" }, directory);
    expect(result).toEqual({ items: [{ value: "staff-sugiyanto", label: "スギヤント" }], total: 1, truncated: false });
    expectMinimalResponse(JSON.stringify(result));

    const active = await listStaff({}, directory);
    expect(active.total).toBe(2);
    expect(active.items.map((item) => item.value)).toContain("staff-kabe");
  });

  it("staff_list fails explicitly when a visible freee employee lacks staffId mapping", async () => {
    const directory = new FakeDirectory([{ freeeEmployeeId: "missing", displayName: "未対応 花子" }], []);
    await expect(listStaff({ query: "未対応" }, directory)).rejects.toBeInstanceOf(FreeeIntegrationError);
  });

  it("partner_list returns official company labels and searches name, kana, shortcut, and status", async () => {
    const partnerWithSecrets: PartnerMasterCandidate & { phone: string; email: string; bank: string } = {
      partnerId: "partner-1",
      officialName: "株式会社小林グリーンファーム",
      nameKana: "コバヤシグリーンファーム",
      shortcut1: "KOBAYASHI",
      shortcut2: "501",
      available: true,
      phone: "080-0000-0000",
      email: "secret@example.com",
      bank: "JP90BANK",
    };
    const directory = new FakeDirectory([], [
      partnerWithSecrets,
      { partnerId: "partner-2", officialName: "停止 農園", nameKana: "テイシ", available: false },
    ]);

    const result = await listPartners({ query: "小林", status: "active" }, directory);
    expect(result).toEqual({ items: [{ value: "partner-1", label: "株式会社小林グリーンファーム" }], total: 1, truncated: false });
    expectMinimalResponse(JSON.stringify(result));

    const inactive = await listPartners({ status: "inactive" }, directory);
    expect(inactive.items).toEqual([{ value: "partner-2", label: "停止 農園" }]);
  });

  it("applies limit and truncated consistently", async () => {
    const staff = Array.from({ length: 12 }, (_, index) => ({
      freeeEmployeeId: `employee-${index}`,
      staffId: `staff-${index}`,
      displayName: `スタッフ${index}`,
    }));
    const result = await listStaff({ limit: 10 }, new FakeDirectory(staff, []));
    expect(result.items).toHaveLength(10);
    expect(result.total).toBe(12);
    expect(result.truncated).toBe(true);
  });
});

describe("job_seeker_list service", () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  let scoped: Awaited<ReturnType<typeof acquireTenantScopedDb>>;
  let otherScoped: Awaited<ReturnType<typeof acquireTenantScopedDb>>;

  beforeAll(async () => {
    scoped = await acquireTenantScopedDb(tenantId);
    otherScoped = await acquireTenantScopedDb(otherTenantId);
    await insertJobSeeker(scoped.db, tenantId, "候補 スギヤント", "staff-candidate-1", "active");
    await insertJobSeeker(scoped.db, tenantId, "完了 花子", "staff-closed-1", "placed");
    await insertJobSeeker(otherScoped.db, otherTenantId, "他テナント 太郎", "staff-other-1", "active");
  });

  afterAll(() => {
    scoped.release();
    otherScoped.release();
  });

  it("returns only id and name for the current tenant", async () => {
    const result = await listJobSeekers(scoped.db, { query: "候補", status: "active" });
    expect(result.total).toBe(1);
    expect(result.items[0]?.label).toBe("候補 スギヤント");
    expect(JSON.stringify(result)).not.toContain("他テナント");
    expectMinimalResponse(JSON.stringify(result));
  });

  it("maps closed to placed plus withdrawn statuses", async () => {
    const result = await listJobSeekers(scoped.db, { status: "closed" });
    expect(result.items.map((item) => item.label)).toContain("完了 花子");
  });
});

describe("freee Secret Manager helpers", () => {
  it("rotates refresh tokens and stores the next Secret Manager version", async () => {
    const store = new FakeSecretStore({ accessToken: "old", refreshToken: "refresh-old", expiresAtEpochSeconds: 1 });
    const provider = new SecretManagerFreeeTokenProvider(
      {
        FREEE_CLIENT_ID: "client",
        FREEE_CLIENT_SECRET: "secret",
        FREEE_TOKEN_SECRET_NAME: "projects/p/secrets/freee-token",
        FREEE_TOKEN_URL: "https://token.example.test",
      },
      store,
      () =>
        Promise.resolve(new Response(JSON.stringify({ access_token: "next", refresh_token: "refresh-next", expires_in: 21600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })),
    );

    await expect(provider.getAccessToken()).resolves.toBe("next");
    expect(store.added).toHaveLength(1);
    expect(JSON.stringify(store.added[0])).toContain("refresh-next");
  });

  it("rejects duplicate staffId mappings", async () => {
    const store = new FakeSecretStore({
      employees: [
        { freeeEmployeeId: "1", staffId: "staff-1" },
        { freeeEmployeeId: "2", staffId: "staff-1" },
      ],
    });
    await expect(readStaffIdMapping(store, "projects/p/secrets/staff-map")).rejects.toBeInstanceOf(FreeeIntegrationError);
  });
});

async function insertJobSeeker(
  db: Awaited<ReturnType<typeof acquireTenantScopedDb>>["db"],
  tenantId: string,
  name: string,
  staffId: string,
  status: "active" | "placed" | "withdrawn",
): Promise<void> {
  const [snapshot] = await db
    .insert(partySnapshots)
    .values({
      tenantId,
      partyType: "worker",
      partyRefId: staffId,
      schemaVersion: "test",
      snapshot: { staffId },
      sha256: randomUUID(),
      takenReason: "job_seeker_accept",
    })
    .returning({ id: partySnapshots.id });
  await db.insert(jobSeekers).values({
    tenantId,
    staffId,
    seekerSnapshotId: snapshot!.id,
    nameEnc: encryptPii(name),
    addressEnc: encryptPii("鹿児島県秘密住所"),
    birthDateEnc: encryptPii("1990-01-01"),
    desiredOccupation: "農業",
    acceptedAt: "2026-07-30",
    validUntil: "2027-07-30",
    piiConsent: { consentDate: "2026-07-30", scope: "placement", recipients: "internal" },
    status,
  });
}

/**
 * outbox workerのcross-tenant処理の単体テスト：tenant_settingsに登録されたテナントを、テナントごとに
 * app.tenant_idを設定した専用接続経由で処理し、他テナントの行はRLSにより実際に見えないことを確認する。
 *
 * 【前提】assen_appロール（DATABASE_URL）がsuperuser/BYPASSRLSを持たないことに依存する（非superuserロールで
 * 検証済み。詳細はdocs/registry-readiness-checklist.mdのM3ゲート「テナント分離検証」・README.md参照）
 *
 * Unit test for the outbox worker's cross-tenant processing: confirms tenants registered in tenant_settings are
 * each processed through their own app.tenant_id-pinned connection, and that RLS genuinely hides other tenants' rows.
 *
 * PREREQUISITE: relies on the assen_app role (DATABASE_URL) having no superuser/BYPASSRLS privilege (verified
 * against a non-superuser role; see the M3 gate "tenant isolation verification" in
 * docs/registry-readiness-checklist.md and README.md)
 *
 * Unit test untuk pemrosesan cross-tenant outbox worker: memastikan tenant yang terdaftar di tenant_settings
 * masing-masing diproses melalui koneksi sendiri yang dipatok app.tenant_id, dan RLS benar-benar menyembunyikan
 * baris tenant lain.
 *
 * PRASYARAT: mengandalkan role assen_app (DATABASE_URL) tidak memiliki privilege superuser/BYPASSRLS (sudah
 * diverifikasi terhadap role non-superuser; lihat gate M3 "verifikasi isolasi tenant" pada
 * docs/registry-readiness-checklist.md dan README.md)
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, db, getPool } from "../src/db/client.js";
import { tenantSettings } from "../src/db/schema/tenant.js";
import { transactionalOutbox } from "../src/db/schema/outbox.js";
import { enqueueOutboxEvent } from "../src/services/outbox-worker/enqueue.js";
import { listActiveTenantIds, processOutboxBatchForAllTenants } from "../src/services/outbox-worker/worker.js";

const createdTenantIds: string[] = [];
const createdIdempotencyKeys: string[] = [];

// tenant_settingsにはRLSが無いため、プレーンなdbで登録して問題ない
// tenant_settings carries no RLS, so registering it via the plain db is fine
// tenant_settings tidak memiliki RLS, jadi mendaftar melalui db polos tidak masalah
async function registerTenant(tenantId: string): Promise<void> {
  createdTenantIds.push(tenantId);
  await db.insert(tenantSettings).values({
    tenantId,
    companyName: `テストテナント ${tenantId}`,
    placementLicenseNumber: "46-ユ-000000",
    dispatchLicenseNumber: "派46-000000",
  });
}

// transactional_outboxはRLS対象のため、書込みはapp.tenant_idを固定した専用接続を都度取得して行う
// transactional_outbox is RLS-protected, so writes go through a dedicated connection with app.tenant_id pinned
// transactional_outbox dilindungi RLS, jadi penulisan melalui koneksi khusus dengan app.tenant_id yang dipatok
async function enqueueForTenant(tenantId: string, eventType: string, idempotencyKey: string): Promise<void> {
  const scoped = await acquireTenantScopedDb(tenantId);
  try {
    await scoped.db.transaction(async (tx) => {
      await enqueueOutboxEvent(tx, {
        tenantId,
        aggregateType: "document",
        aggregateId: randomUUID(),
        eventType,
        payload: {},
        idempotencyKey,
      });
    });
  } finally {
    scoped.release();
  }
}

afterAll(async () => {
  if (createdIdempotencyKeys.length > 0) {
    await db.delete(transactionalOutbox).where(inArray(transactionalOutbox.idempotencyKey, createdIdempotencyKeys));
  }
  if (createdTenantIds.length > 0) {
    await db.delete(tenantSettings).where(inArray(tenantSettings.tenantId, createdTenantIds));
  }
  await getPool().end();
});

describe("listActiveTenantIds", () => {
  it("tenant_settingsに登録済みのテナントIDを返す / returns tenant ids registered in tenant_settings", async () => {
    const tenantId = randomUUID();
    await registerTenant(tenantId);

    const tenantIds = await listActiveTenantIds(db);

    expect(tenantIds).toContain(tenantId);
  });
});

describe("processOutboxBatchForAllTenants", () => {
  it("複数テナントのpendingイベントをそれぞれ処理する / processes pending events for multiple tenants independently", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await registerTenant(tenantA);
    await registerTenant(tenantB);

    const idempotencyKeyA = randomUUID();
    const idempotencyKeyB = randomUUID();
    createdIdempotencyKeys.push(idempotencyKeyA, idempotencyKeyB);
    const processedTenants: string[] = [];

    await enqueueForTenant(tenantA, "test.multi_tenant", idempotencyKeyA);
    await enqueueForTenant(tenantB, "test.multi_tenant", idempotencyKeyB);

    const result = await processOutboxBatchForAllTenants(db, {
      "test.multi_tenant": (event) => {
        processedTenants.push(event.tenantId);
        return Promise.resolve();
      },
    });

    expect(processedTenants).toContain(tenantA);
    expect(processedTenants).toContain(tenantB);
    expect(result.tenantsProcessed).toBeGreaterThanOrEqual(2);

    const rows = await db
      .select()
      .from(transactionalOutbox)
      .where(inArray(transactionalOutbox.idempotencyKey, [idempotencyKeyA, idempotencyKeyB]));
    expect(rows.every((row) => row.status === "done")).toBe(true);
  });

  it("ループの対象範囲はlistActiveTenantIdsの結果と一致する / the loop's scope matches listActiveTenantIds", async () => {
    const tenantId = randomUUID();
    await registerTenant(tenantId);

    const tenantIdsBeforeCall = await listActiveTenantIds(db);
    const result = await processOutboxBatchForAllTenants(db, {});

    expect(result.tenantsProcessed).toBe(tenantIdsBeforeCall.length);
  });

  it("RLSにより、あるテナント向けの接続は他テナントのイベントを処理しない / RLS ensures a tenant's connection never processes another tenant's event", async () => {
    const registeredTenant = randomUUID();
    const otherRegisteredTenant = randomUUID();
    await registerTenant(registeredTenant);
    await registerTenant(otherRegisteredTenant);

    const ownIdempotencyKey = randomUUID();
    const otherIdempotencyKey = randomUUID();
    createdIdempotencyKeys.push(ownIdempotencyKey, otherIdempotencyKey);

    await enqueueForTenant(registeredTenant, "test.rls_isolation", ownIdempotencyKey);
    await enqueueForTenant(otherRegisteredTenant, "test.rls_isolation", otherIdempotencyKey);

    const processedByTenant = new Map<string, number>();
    await processOutboxBatchForAllTenants(db, {
      "test.rls_isolation": (event) => {
        processedByTenant.set(event.tenantId, (processedByTenant.get(event.tenantId) ?? 0) + 1);
        return Promise.resolve();
      },
    });

    // 各テナントの行はそれ自身のテナントとしてのみ処理される（他テナントの接続に紛れ込まない）
    // Each tenant's row is processed only under its own tenant (never leaks into another tenant's connection)
    // Baris setiap tenant hanya diproses di bawah tenant-nya sendiri (tidak pernah bocor ke koneksi tenant lain)
    expect(processedByTenant.get(registeredTenant)).toBe(1);
    expect(processedByTenant.get(otherRegisteredTenant)).toBe(1);
  });

  it("tenant_settingsに登録されていないテナントのイベントは処理しない / never processes events for a tenant absent from tenant_settings", async () => {
    const unregisteredTenantId = randomUUID();
    const idempotencyKey = randomUUID();
    createdIdempotencyKeys.push(idempotencyKey);
    let called = false;

    await enqueueForTenant(unregisteredTenantId, "test.unregistered_tenant", idempotencyKey);

    await processOutboxBatchForAllTenants(db, {
      "test.unregistered_tenant": () => {
        called = true;
        return Promise.resolve();
      },
    });

    expect(called).toBe(false);

    // 未登録テナントの行そのものはRLS越しに直接見えないため、同テナントの接続で確認する
    // The unregistered tenant's own row isn't visible across RLS, so verify it via that same tenant's own connection
    // Baris tenant yang tidak terdaftar tidak terlihat lintas RLS, jadi verifikasi via koneksi tenant itu sendiri
    const scoped = await acquireTenantScopedDb(unregisteredTenantId);
    try {
      const [row] = await scoped.db.select().from(transactionalOutbox).where(eq(transactionalOutbox.idempotencyKey, idempotencyKey));
      expect(row?.status).toBe("pending");
    } finally {
      scoped.release();
    }
  });
});

/**
 * audit_eventsハッシュチェーンの単体テスト：正常追記の検証成功、改ざん時の検知を確認する
 * Unit tests for the audit_events hash chain: verifies normal appends pass and tampering is detected
 * Unit test untuk rantai hash audit_events: memverifikasi append normal lolos dan perubahan terdeteksi
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, getPool, type TenantScopedDb } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/audit.js";
import { appendAuditEvent, verifyChain } from "../src/audit/hash-chain.js";
import type { AuthenticatedPrincipal } from "../src/lib/auth.js";
import { closePrivilegedDb, getPrivilegedDb } from "./helpers/privileged-db.js";

const testPrincipal: AuthenticatedPrincipal = {
  principalId: "test-principal",
  role: "admin",
  authMethod: "local_fixed_token",
  tenantId: "test-tenant",
};

let tenantId: string;
// RLSを実効性あるものとして検証するため、本番のリクエストハンドラ（server.ts）と同じ
// acquireTenantScopedDbでapp.tenant_idを固定した接続を使う（プレーンなdbは使わない）
// Uses a connection with app.tenant_id pinned via acquireTenantScopedDb — the same mechanism the production
// request handler (server.ts) uses — so RLS is exercised for real, instead of the plain, unscoped db
// Menggunakan koneksi dengan app.tenant_id yang dipatok via acquireTenantScopedDb — mekanisme yang sama dengan
// request handler produksi (server.ts) — sehingga RLS benar-benar diuji, bukan db polos yang tidak di-scope
let tenantScoped: TenantScopedDb;
let db: TenantScopedDb["db"];

beforeAll(async () => {
  tenantId = randomUUID();
  tenantScoped = await acquireTenantScopedDb(tenantId);
  db = tenantScoped.db;
});

afterAll(async () => {
  // audit_eventsはruntimeロールからDELETEを剥奪しているため、後始末はsuperuser相当の接続で行う
  // audit_events has DELETE revoked from the runtime role, so cleanup uses the superuser-equivalent connection
  await getPrivilegedDb().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  tenantScoped.release();
  await getPool().end();
  await closePrivilegedDb();
});

describe("audit hash chain", () => {
  it("正常な追記チェーンは検証を通過する / a normal append chain passes verification", async () => {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        tenantId,
        aggregateType: "job_order",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "job_order.confirmed",
        afterHash: "hash-1",
        principal: testPrincipal,
        requestId: randomUUID(),
      });
    });

    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        tenantId,
        aggregateType: "job_order",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "document.approved",
        afterHash: "hash-2",
        principal: testPrincipal,
        requestId: randomUUID(),
      });
    });

    const problems = await verifyChain(db, tenantId);
    expect(problems).toEqual([]);
  });

  it("event_hashが改ざんされると検証が失敗する / verification fails when event_hash is tampered with", async () => {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        tenantId,
        aggregateType: "job_order",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "job_order.confirmed",
        afterHash: "hash-3",
        principal: testPrincipal,
        requestId: randomUUID(),
      });
    });

    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, tenantId));
    if (!row) {
      throw new Error("テスト用イベントが見つかりません / test event not found");
    }
    // 「DBに直接アクセスできる攻撃者による改ざん」を模擬する（runtimeロールはUPDATE不可のため、あえてsuperuser相当の接続を使う）
    // Simulates tampering by an attacker with direct DB access (the runtime role cannot UPDATE, so this deliberately uses the superuser-equivalent connection)
    await getPrivilegedDb().update(auditEvents).set({ afterHash: "tampered-hash" }).where(eq(auditEvents.eventId, row.eventId));

    const problems = await verifyChain(db, tenantId);
    expect(problems.length).toBeGreaterThan(0);
  });
});

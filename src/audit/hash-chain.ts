/**
 * audit_eventsのハッシュチェーン書込。テナントごとに単一チェーンを維持し、
 * 直前イベントのevent_hashをprevious_event_hashとして連結する
 * Hash-chain writer for audit_events. Maintains a single chain per tenant,
 * linking the previous event's event_hash as previous_event_hash
 * Penulis rantai hash untuk audit_events. Menjaga satu rantai per tenant,
 * menautkan event_hash event sebelumnya sebagai previous_event_hash
 */
import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema/index.js";
import { auditEvents } from "../db/schema/audit.js";
import { canonicalJsonString, sha256Hex } from "../lib/hash.js";
import type { AuthenticatedPrincipal } from "../lib/auth.js";

type DbOrTx = NodePgDatabase<typeof schema>;

export interface AppendAuditEventInput {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  beforeHash?: string;
  afterHash: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  traceId?: string;
  sourceIpOrRuntime?: string;
}

/**
 * audit_eventsへ1件追記する。呼び出し側は業務更新と同一トランザクション内で呼ぶこと（アウトボックスと同じ規律）
 * Appends a single audit_events row. Callers must invoke this within the same transaction as the business update (same discipline as the outbox)
 * Menambahkan satu baris audit_events. Pemanggil harus memanggil ini dalam transaksi yang sama dengan pembaruan bisnis (disiplin sama seperti outbox)
 */
export async function appendAuditEvent(tx: DbOrTx, input: AppendAuditEventInput): Promise<{ eventId: string; eventHash: string }> {
  // テナントごとのアドバイザリロックで直列化する（`SELECT ... FOR UPDATE`は行ロックにUPDATE権限を要求するため、
  // audit_eventsにUPDATE権限を持たないruntimeロール（改ざん防止のためUPDATE/DELETEを剥奪、002_grant_runtime_role.sql）
  // では使えない。アドバイザリロックはテーブル権限に依存しないため両立できる）
  // Serializes per tenant via an advisory lock (`SELECT ... FOR UPDATE` requires UPDATE privilege for its row lock,
  // which the runtime role cannot have on audit_events — UPDATE/DELETE are revoked to prevent tampering, see
  // 002_grant_runtime_role.sql. Advisory locks need no table privilege, so this stays compatible)
  // Menyerialkan per tenant via advisory lock (`SELECT ... FOR UPDATE` membutuhkan privilege UPDATE untuk row
  // lock-nya, yang tidak boleh dimiliki role runtime pada audit_events — UPDATE/DELETE dicabut untuk mencegah
  // perubahan, lihat 002_grant_runtime_role.sql. Advisory lock tidak membutuhkan privilege tabel, jadi tetap cocok)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.tenantId}, 0))`);

  const [previous] = await tx
    .select({ eventHash: auditEvents.eventHash })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, input.tenantId))
    .orderBy(desc(auditEvents.chainSequence))
    .limit(1);

  const eventId = randomUUID();
  const occurredAt = new Date();
  const previousEventHash = previous?.eventHash ?? null;

  const eventHash = sha256Hex(
    canonicalJsonString({
      eventId,
      tenantId: input.tenantId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      eventType: input.eventType,
      beforeHash: input.beforeHash ?? null,
      afterHash: input.afterHash,
      actorPrincipalId: input.principal.principalId,
      actorRole: input.principal.role,
      authMethod: input.principal.authMethod,
      requestId: input.requestId,
      traceId: input.traceId ?? null,
      sourceIpOrRuntime: input.sourceIpOrRuntime ?? null,
      occurredAt: occurredAt.toISOString(),
      previousEventHash,
    }),
  );

  await tx.insert(auditEvents).values({
    eventId,
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    eventType: input.eventType,
    beforeHash: input.beforeHash,
    afterHash: input.afterHash,
    actorPrincipalId: input.principal.principalId,
    actorRole: input.principal.role,
    authMethod: input.principal.authMethod,
    requestId: input.requestId,
    traceId: input.traceId,
    sourceIpOrRuntime: input.sourceIpOrRuntime,
    occurredAt,
    previousEventHash,
    eventHash,
  });

  return { eventId, eventHash };
}

export interface ChainVerificationProblem {
  eventId: string;
  reason: string;
}

/**
 * 指定テナント（省略時は全テナント）のチェーンを再計算し、改ざん・欠落を検出する
 * Recomputes the chain for a given tenant (or all tenants) and detects tampering or gaps
 * Menghitung ulang rantai untuk tenant tertentu (atau semua tenant) dan mendeteksi perubahan atau celah
 */
export async function verifyChain(tx: DbOrTx, tenantId?: string): Promise<ChainVerificationProblem[]> {
  const rows = tenantId
    ? await tx.select().from(auditEvents).where(eq(auditEvents.tenantId, tenantId)).orderBy(auditEvents.chainSequence)
    : await tx.select().from(auditEvents).orderBy(auditEvents.tenantId, auditEvents.chainSequence);

  const problems: ChainVerificationProblem[] = [];
  const expectedPrevious: Record<string, string | null> = {};

  for (const row of rows) {
    const previousForTenant = expectedPrevious[row.tenantId] ?? null;
    if ((row.previousEventHash ?? null) !== previousForTenant) {
      problems.push({
        eventId: row.eventId,
        reason: `previous_event_hashが不整合です（期待値: ${previousForTenant ?? "null"}、実際: ${row.previousEventHash ?? "null"}） / previous_event_hash mismatch (expected ${previousForTenant ?? "null"}, got ${row.previousEventHash ?? "null"})`,
      });
    }

    const recomputed = sha256Hex(
      canonicalJsonString({
        eventId: row.eventId,
        tenantId: row.tenantId,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        aggregateVersion: row.aggregateVersion,
        eventType: row.eventType,
        beforeHash: row.beforeHash ?? null,
        afterHash: row.afterHash,
        actorPrincipalId: row.actorPrincipalId,
        actorRole: row.actorRole,
        authMethod: row.authMethod,
        requestId: row.requestId,
        traceId: row.traceId ?? null,
        sourceIpOrRuntime: row.sourceIpOrRuntime ?? null,
        occurredAt: row.occurredAt.toISOString(),
        previousEventHash: row.previousEventHash ?? null,
      }),
    );

    if (recomputed !== row.eventHash) {
      problems.push({
        eventId: row.eventId,
        reason: `event_hashが再計算値と一致しません（改ざんの疑い） / event_hash does not match recomputed value (possible tampering)`,
      });
    }

    expectedPrevious[row.tenantId] = row.eventHash;
  }

  return problems;
}

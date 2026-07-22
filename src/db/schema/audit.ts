/**
 * 改ざん困難なハッシュチェーン監査ログ（§4.6）。UPDATE/DELETE権限はruntimeロールから剥奪する
 * Tamper-resistant hash-chained audit log (§4.6). UPDATE/DELETE privileges are revoked from the runtime role
 * Log audit berantai hash yang tahan terhadap perubahan (§4.6). Privilese UPDATE/DELETE dicabut dari role runtime
 */
import { bigserial, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantIdColumn } from "./common.js";

export const auditEvents = pgTable("audit_events", {
  // チェーン順序を一意に決めるための単調増加列（occurred_atだけでは同時刻イベントの順序を保証できない）
  // Monotonically increasing column that fixes chain order (occurred_at alone cannot order same-timestamp events)
  // Kolom yang meningkat monoton untuk menetapkan urutan rantai (occurred_at saja tidak dapat mengurutkan event dengan timestamp sama)
  chainSequence: bigserial("chain_sequence", { mode: "bigint" }).notNull(),
  eventId: text("event_id").primaryKey(),
  tenantId: tenantIdColumn(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  aggregateVersion: integer("aggregate_version").notNull(),
  eventType: text("event_type").notNull(),
  beforeHash: text("before_hash"),
  afterHash: text("after_hash").notNull(),
  actorPrincipalId: text("actor_principal_id").notNull(),
  actorRole: text("actor_role").notNull(),
  authMethod: text("auth_method").notNull(),
  requestId: text("request_id").notNull(),
  traceId: text("trace_id"),
  sourceIpOrRuntime: text("source_ip_or_runtime"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  // チェーン：直前イベントのevent_hashを保持し、event_hashは全カラムから再計算する
  // Chain: holds the previous event's event_hash; event_hash is recomputed from all columns
  // Rantai: menyimpan event_hash dari event sebelumnya; event_hash dihitung ulang dari semua kolom
  previousEventHash: text("previous_event_hash"),
  eventHash: text("event_hash").notNull(),
});

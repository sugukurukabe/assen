/**
 * transactional outbox（§2.2）：DBトランザクション内で状態変更とイベントを同時コミットし、外部反映は冪等workerに委ねる
 * Transactional outbox (§2.2): commits state change + event atomically; external side effects are handled by an idempotent worker
 * Transactional outbox (§2.2): meng-commit perubahan status + event secara atomik; efek samping eksternal ditangani worker idempotent
 */
import { integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, tenantIdColumn } from "./common.js";

export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "processing", "done", "dead"]);

export const transactionalOutbox = pgTable("transactional_outbox", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: outboxStatusEnum("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  lastError: text("last_error"),
  externalReference: text("external_reference"),
  createdAt: createdAtColumn(),
});

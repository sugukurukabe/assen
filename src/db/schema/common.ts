/**
 * 全テーブル共通のカラム定義（id/created_at/updated_at/tenant_id）
 * Column helpers shared by every table (id/created_at/updated_at/tenant_id)
 * Helper kolom yang dibagikan oleh semua tabel (id/created_at/updated_at/tenant_id)
 */
import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

export const idColumn = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
export const createdAtColumn = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAtColumn = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
export const tenantIdColumn = () => uuid("tenant_id").notNull();

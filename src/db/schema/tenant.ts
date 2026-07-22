/**
 * テナント設定。許可番号（有料職業紹介・労働者派遣）の唯一の参照元
 * Tenant settings. The single source of truth for licence numbers (paid placement / worker dispatch)
 * Pengaturan tenant. Satu-satunya sumber kebenaran untuk nomor lisensi (penempatan berbayar / dispatch pekerja)
 */
import { pgTable, text } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, updatedAtColumn } from "./common.js";

export const tenantSettings = pgTable("tenant_settings", {
  id: idColumn(),
  tenantId: text("tenant_id").notNull().unique(),
  companyName: text("company_name").notNull(),
  // 有料職業紹介事業許可番号（例: 46-ユ-000000） / Paid placement business licence number / Nomor lisensi bisnis penempatan berbayar
  placementLicenseNumber: text("placement_license_number").notNull(),
  // 労働者派遣事業許可番号（例: 派46-000000） / Worker dispatch business licence number / Nomor lisensi bisnis dispatch pekerja
  dispatchLicenseNumber: text("dispatch_license_number").notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

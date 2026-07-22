/**
 * 法的イベント時点の不変スナップショット（§4.3）。マスタは参照のみ、表示はスナップショットを使う
 * Immutable point-in-time snapshots for legal events (§4.3). Masters are referenced only; display uses snapshots
 * Snapshot titik-waktu yang tidak berubah untuk peristiwa hukum (§4.3). Master hanya dirujuk; tampilan memakai snapshot
 */
import { jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, tenantIdColumn } from "./common.js";

export const partyTypeEnum = pgEnum("party_type", ["company", "worker", "tenant_self"]);

export const takenReasonEnum = pgEnum("snapshot_taken_reason", [
  "job_order_accept",
  "contract_approve",
  "placement_confirm",
]);

export const partySnapshots = pgTable("party_snapshots", {
  id: idColumn(),
  tenantId: tenantIdColumn(),
  partyType: partyTypeEnum("party_type").notNull(),
  partyRefId: text("party_ref_id").notNull(),
  schemaVersion: text("schema_version").notNull(),
  // 凍結コピー: 名称・所在地・代表者・許可番号・担当者等 / Frozen copy: name, address, representative, licence number, contact / Kopi beku: nama, alamat, perwakilan, nomor lisensi, kontak
  snapshot: jsonb("snapshot").notNull(),
  sha256: text("sha256").notNull(),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  takenReason: takenReasonEnum("taken_reason").notNull(),
  createdAt: createdAtColumn(),
});

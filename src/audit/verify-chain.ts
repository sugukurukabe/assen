/**
 * audit_eventsのハッシュチェーンを検証するCLI。M0/M1ゲートの「chain検証グリーン」を確認するために使う。
 * テナント指定なし（全テナント横断）で検証するため、RLS（app.tenant_id単位）ではなくMIGRATION_DATABASE_URL
 * （superuser相当・読み取り専用で使用）で接続する運用/監査ツール。migrate.tsと同じ権限分離の考え方（設計書§2.3）
 *
 * CLI that verifies the audit_events hash chain. Used to confirm the M0/M1 gate's "chain verification green" condition.
 * Since it verifies across all tenants (not scoped to one), it connects via MIGRATION_DATABASE_URL (superuser-equivalent,
 * used read-only here) rather than per-tenant RLS. Same privilege-separation idea as migrate.ts (design doc §2.3)
 *
 * CLI yang memverifikasi rantai hash audit_events. Digunakan untuk memastikan kondisi gate M0/M1 "verifikasi rantai hijau".
 * Karena memverifikasi lintas semua tenant (bukan satu tenant), koneksi memakai MIGRATION_DATABASE_URL (setara
 * superuser, dipakai read-only di sini) bukan RLS per tenant. Ide pemisahan privilege yang sama seperti migrate.ts (dokumen desain §2.3)
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadEnv } from "../lib/env.js";
import * as schema from "../db/schema/index.js";
import { verifyChain } from "./hash-chain.js";
import { logMessage } from "../lib/logger.js";

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL || env.DATABASE_URL, max: 2 });
  const privilegedDb = drizzle(pool, { schema });

  const problems = await verifyChain(privilegedDb, tenantId);

  if (problems.length === 0) {
    logMessage("info", "audit chain検証: 問題なし / audit chain verification: no problems found", { tenantId: tenantId ?? "all" });
  } else {
    logMessage("critical", "audit chain検証: 問題を検出 / audit chain verification: problems detected", {
      count: problems.length,
    });
    for (const problem of problems) {
      logMessage("error", problem.reason, { eventId: problem.eventId });
    }
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch((error: unknown) => {
  logMessage("critical", "audit chain検証に失敗しました / audit chain verification failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

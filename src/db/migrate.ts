/**
 * drizzle-kitが生成したSQLマイグレーションを適用し、続けてRLSポリシー・runtimeロールへのGRANT SQLを適用するCLI。
 * runtimeが使う`DATABASE_URL`とは別に`MIGRATION_DATABASE_URL`（superuser相当）で接続する
 * （db/client.tsの共有poolは再利用しない。migration権限とruntime権限の分離、設計書§2.3）
 *
 * CLI that applies drizzle-kit-generated SQL migrations, then the RLS policy / runtime-role GRANT SQL.
 * Connects via `MIGRATION_DATABASE_URL` (superuser-equivalent), separate from the runtime `DATABASE_URL`
 * (does not reuse db/client.ts's shared pool — separates migration privileges from runtime privileges, design doc §2.3)
 *
 * CLI yang menerapkan migrasi SQL yang dihasilkan drizzle-kit, lalu SQL kebijakan RLS / GRANT role runtime.
 * Terhubung via `MIGRATION_DATABASE_URL` (setara superuser), terpisah dari `DATABASE_URL` runtime
 * (tidak menggunakan ulang pool bersama db/client.ts — memisahkan privilege migrasi dari privilege runtime, dokumen desain §2.3)
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadEnv } from "../lib/env.js";
import { logMessage } from "../lib/logger.js";
import * as schema from "./schema/index.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

async function applyRlsPolicies(pool: Pool): Promise<void> {
  const rlsDir = join(currentDir, "rls");
  const files = readdirSync(rlsDir).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sqlText = readFileSync(join(rlsDir, file), "utf8");
    logMessage("info", "RLSポリシー・GRANT SQLを適用します / Applying RLS policy / GRANT SQL file", { file });
    await pool.query(sqlText);
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const migrationConnectionString = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
  if (!env.MIGRATION_DATABASE_URL) {
    logMessage(
      "warning",
      "MIGRATION_DATABASE_URLが未設定のためDATABASE_URLで接続します。ロール分離済みの環境ではMIGRATION_DATABASE_URLを設定してください / MIGRATION_DATABASE_URL is unset; falling back to DATABASE_URL. Set MIGRATION_DATABASE_URL once roles are separated",
    );
  }

  const pool = new Pool({ connectionString: migrationConnectionString });
  const migrationDb = drizzle(pool, { schema });

  try {
    logMessage("info", "drizzleマイグレーションを適用します / Applying drizzle migrations");
    await migrate(migrationDb, { migrationsFolder: join(currentDir, "migrations") });
    await applyRlsPolicies(pool);
    logMessage("info", "マイグレーション完了 / Migration complete");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  logMessage("critical", "マイグレーションに失敗しました / Migration failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

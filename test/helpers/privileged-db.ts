/**
 * テスト専用：MIGRATION_DATABASE_URL（superuser相当）で接続するヘルパー。
 * audit_eventsはruntimeロール（assen_app）からUPDATE/DELETEを剥奪しているため、
 * テストの後始末（クリーンアップ）や「DBに直接アクセスした攻撃者による改ざん」を模擬する場合はこちらを使う。
 * アプリのランタイムコードから使ってはならない（superuser経路のため）
 *
 * Test-only: helper that connects with MIGRATION_DATABASE_URL (superuser-equivalent).
 * Since audit_events has UPDATE/DELETE revoked from the runtime role (assen_app), use this for
 * test cleanup or to simulate "an attacker with direct DB access tampering with rows".
 * Must never be used from application runtime code (it is a superuser path)
 *
 * Khusus untuk test: helper yang terhubung dengan MIGRATION_DATABASE_URL (setara superuser).
 * Karena audit_events mencabut UPDATE/DELETE dari role runtime (assen_app), gunakan ini untuk
 * pembersihan test atau untuk mensimulasikan "penyerang dengan akses DB langsung yang mengubah baris".
 * Jangan pernah dipakai dari kode runtime aplikasi (ini jalur superuser)
 */
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadEnv } from "../../src/lib/env.js";
import * as schema from "../../src/db/schema/index.js";

let privilegedPool: Pool | undefined;

export function getPrivilegedDb(): NodePgDatabase<typeof schema> {
  if (!privilegedPool) {
    const env = loadEnv();
    privilegedPool = new Pool({
      connectionString: env.MIGRATION_DATABASE_URL || env.DATABASE_URL,
      max: 2,
    });
  }
  return drizzle(privilegedPool, { schema });
}

export async function closePrivilegedDb(): Promise<void> {
  if (privilegedPool) {
    await privilegedPool.end();
    privilegedPool = undefined;
  }
}

/**
 * DrizzleのPostgresクライアント。RLSを効かせるため、runtimeロールで接続しSET app.tenant_idを都度設定する
 * Drizzle Postgres client. Connects as the runtime role and sets app.tenant_id per request so RLS applies
 * Klien Postgres Drizzle. Terhubung sebagai role runtime dan mengatur app.tenant_id per permintaan agar RLS berlaku
 */
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { loadEnv } from "../lib/env.js";
import * as schema from "./schema/index.js";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_MAX,
      idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
    });
  }
  return pool;
}

export const db = drizzle(getPool(), { schema });

/**
 * テナントRLSのために現在のSQLセッションへapp.tenant_idを設定する。トランザクション内で必ず呼ぶ
 * Sets app.tenant_id on the current SQL session for tenant RLS. Must be called inside the transaction
 * Mengatur app.tenant_id pada sesi SQL saat ini untuk RLS tenant. Harus dipanggil di dalam transaksi
 */
export async function setTenantContext(tx: typeof db, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
}

export interface TenantScopedDb {
  readonly db: NodePgDatabase<typeof schema>;
  release(): void;
}

/**
 * リクエスト専用のPostgres接続を1本pool checkoutし、app.tenant_idをセッション全体に固定してからdrizzleへ渡す。
 * これにより、transactionの有無に関わらずリクエスト内の全クエリでRLSのテナント分離が効く（§4）
 * Checks out one dedicated Postgres connection for the request, pins app.tenant_id for the whole session,
 * then hands it to drizzle. This makes RLS tenant isolation apply to every query in the request regardless
 * of whether it runs inside an explicit transaction (§4)
 * Mengambil satu koneksi Postgres khusus untuk permintaan, mengunci app.tenant_id untuk seluruh sesi,
 * lalu menyerahkannya ke drizzle. Ini membuat isolasi tenant RLS berlaku pada setiap query dalam permintaan
 * terlepas dari apakah query berjalan di dalam transaksi eksplisit (§4)
 */
export async function acquireTenantScopedDb(tenantId: string): Promise<TenantScopedDb> {
  const client: PoolClient = await getPool().connect();
  await client.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
  const tenantDb = drizzle(client, { schema });
  return {
    db: tenantDb,
    release: () => client.release(),
  };
}

/**
 * 環境変数を読み込み・検証する
 * Loads and validates environment variables
 * Memuat dan memvalidasi variabel lingkungan
 */
import { z } from "zod";

function isValidPiiEncryptionKey(value: string): boolean {
  if (!value) {
    return true;
  }
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  // NODE_ENV=productionでは本番向けの起動時ガード（PII_ENCRYPTION_KEY必須・AUTH_MODE=oauth必須）が有効になる
  // NODE_ENV=production enables production startup guards (PII_ENCRYPTION_KEY required, AUTH_MODE must be oauth)
  // NODE_ENV=production mengaktifkan guard startup produksi (PII_ENCRYPTION_KEY wajib, AUTH_MODE harus oauth)
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // DATABASE_URL: アプリ/テストが使う実行時接続。RLSが実効性を持つよう、superuser/RLSバイパス権限を持たない
  // 制限ロール（既定名: assen_app）で接続することを前提とする（migration権限とruntime権限の分離、設計書§2.3）
  // DATABASE_URL: the runtime connection used by the app/tests. For RLS to actually take effect, this must connect
  // as a restricted role with no superuser/BYPASSRLS privilege (default name: assen_app) — separates migration
  // privileges from runtime privileges per design doc §2.3
  // DATABASE_URL: koneksi runtime yang dipakai app/test. Agar RLS benar-benar berlaku, koneksi ini harus
  // menggunakan role terbatas tanpa privilege superuser/BYPASSRLS (nama default: assen_app) — memisahkan
  // privilege migrasi dari privilege runtime sesuai dokumen desain §2.3
  DATABASE_URL: z.string().min(1),
  // MIGRATION_DATABASE_URL: db:migrate専用の接続（テーブル作成・RLS強制・GRANT付与にはsuperuser相当の権限が必要）。
  // 未設定ならDATABASE_URLへフォールバックする（ロール分離をまだ行っていない簡易セットアップ向け）
  // MIGRATION_DATABASE_URL: the connection dedicated to db:migrate (creating tables, forcing RLS, and granting
  // privileges needs superuser-equivalent rights). Falls back to DATABASE_URL when unset (for simple setups that
  // have not yet separated roles)
  // MIGRATION_DATABASE_URL: koneksi khusus untuk db:migrate (membuat tabel, memaksakan RLS, dan memberi grant
  // membutuhkan hak setara superuser). Fallback ke DATABASE_URL jika tidak diatur (untuk setup sederhana yang
  // belum memisahkan role)
  MIGRATION_DATABASE_URL: z.string().optional().default(""),
  STORAGE_ENDPOINT: z.string().min(1),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1),
  // 値を設定する場合、openssl rand -base64 32 が生成する32byteでなければ起動時に即座に失敗させる
  // If a value is set, it must decode to the 32 bytes produced by `openssl rand -base64 32`, checked eagerly at startup
  // Jika nilai diatur, harus terdekode menjadi 32 byte yang dihasilkan `openssl rand -base64 32`, diperiksa segera saat startup
  PII_ENCRYPTION_KEY: z
    .string()
    .optional()
    .default("")
    .refine(isValidPiiEncryptionKey, "PII_ENCRYPTION_KEYは32byte(base64)である必要があります / PII_ENCRYPTION_KEY must decode to 32 bytes"),
  PORT: z.coerce.number().int().positive().default(8080),
  AUTH_MODE: z.enum(["local_fixed_token", "oauth"]).default("local_fixed_token"),
  AUTH_LOCAL_TOKEN: z.string().optional().default(""),
  // AUTH_MODE=oauth時のトークン検証設定。audience検証必須・token passthrough禁止（設計書§7・§2.4） / Token verification settings for AUTH_MODE=oauth. Audience validation is mandatory; no token passthrough (design doc §7, §2.4) / Setelan verifikasi token untuk AUTH_MODE=oauth. Validasi audience wajib; tidak boleh token passthrough (dokumen desain §7, §2.4)
  OAUTH_ISSUER: z.string().optional().default(""),
  OAUTH_AUDIENCE: z.string().optional().default(""),
  OAUTH_JWKS_URI: z.string().optional().default(""),
  // JWTのどのクレームをrole/tenantIdとして扱うか（IdP側のカスタムクレーム名に合わせる） / Which JWT claims carry role/tenantId (matches the IdP's custom claim names) / Klaim JWT mana yang membawa role/tenantId (menyesuaikan nama klaim khusus IdP)
  OAUTH_ROLE_CLAIM: z.string().min(1).default("role"),
  OAUTH_TENANT_CLAIM: z.string().min(1).default("tenant_id"),
  LLM_API_KEY: z.string().optional().default(""),
  // HTTPリクエストボディの上限（バイト）。署名済み正本のbase64添付を想定し既定20MB / Max HTTP request body size in bytes (default 20MB, sized for base64-attached signed originals) / Batas ukuran body permintaan HTTP dalam byte (default 20MB, disesuaikan untuk lampiran naskah asli berbentuk base64)
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  // DBプール設定（Cloud SQL接続数上限に合わせて環境変数で調整する） / DB pool tuning (adjust via env to respect Cloud SQL connection limits) / Penyesuaian pool DB (sesuaikan via env agar sesuai batas koneksi Cloud SQL)
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  // /mcpへのブラウザ発cross-originアクセスを許可するorigin一覧（カンマ区切り、"*"で全許可）。既定は空＝CORS無効。
  // 公開discoveryエンドポイント（/health・/ready・/.well-known/mcp.json）は常に全origin許可（認証も業務データもないため）
  // Comma-separated list of origins allowed to call /mcp from a browser ("*" allows all). Default empty = CORS disabled for /mcp.
  // Public discovery endpoints (/health, /ready, /.well-known/mcp.json) always allow all origins (no auth, no business data)
  // Daftar origin (dipisah koma) yang diizinkan memanggil /mcp dari browser ("*" mengizinkan semua). Default kosong = CORS dinonaktifkan untuk /mcp.
  // Endpoint discovery publik (/health, /ready, /.well-known/mcp.json) selalu mengizinkan semua origin (tanpa auth, tanpa data bisnis)
  CORS_ALLOWED_ORIGINS: z.string().optional().default(""),
  // Server Card（/.well-known/mcp.json）に載せるrepository/contact URL。未設定ならnullのまま出力する（実在しないURLを作らない）
  // repository/contact URLs published in the Server Card (/.well-known/mcp.json). Left null when unset, rather than fabricating a URL
  // URL repository/contact yang dipublikasikan di Server Card (/.well-known/mcp.json). Dibiarkan null jika tidak diatur, daripada membuat URL palsu
  SERVER_CARD_REPOSITORY_URL: z.string().optional().default(""),
  SERVER_CARD_CONTACT_URL: z.string().optional().default(""),
});

export type AssenEnv = z.infer<typeof envSchema>;

let cachedEnv: AssenEnv | undefined;

/**
 * 検証済みの環境変数を返す（初回のみ検証を実行）
 * Returns validated environment variables (validates only on first call)
 * Mengembalikan variabel lingkungan yang sudah divalidasi (hanya validasi pada panggilan pertama)
 */
export function loadEnv(): AssenEnv {
  if (cachedEnv) {
    return cachedEnv;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
    throw new Error(`環境変数の検証に失敗しました / Environment variable validation failed: ${issues}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

/**
 * NODE_ENV=production起動時にdev専用設定が残っていないかを検証する。違反時はサーバーを起動させない
 * Verifies that dev-only settings are not left in place when NODE_ENV=production. Refuses to start the server on violation
 * Memverifikasi bahwa setelan khusus dev tidak tersisa saat NODE_ENV=production. Menolak memulai server jika melanggar
 */
export function assertProductionSafety(env: AssenEnv): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const violations: string[] = [];
  if (env.AUTH_MODE === "local_fixed_token") {
    violations.push("AUTH_MODE=local_fixed_tokenは開発専用です。本番はAUTH_MODE=oauthにしてください / AUTH_MODE=local_fixed_token is dev-only; use AUTH_MODE=oauth in production");
  }
  if (env.AUTH_MODE === "oauth" && (!env.OAUTH_ISSUER || !env.OAUTH_AUDIENCE || !env.OAUTH_JWKS_URI)) {
    violations.push(
      "AUTH_MODE=oauthにはOAUTH_ISSUER/OAUTH_AUDIENCE/OAUTH_JWKS_URIがすべて必要です / AUTH_MODE=oauth requires OAUTH_ISSUER, OAUTH_AUDIENCE, and OAUTH_JWKS_URI to all be set",
    );
  }
  if (!env.PII_ENCRYPTION_KEY) {
    violations.push("PII_ENCRYPTION_KEYが未設定です / PII_ENCRYPTION_KEY is not set");
  }
  if (violations.length > 0) {
    throw new Error(`本番起動を拒否しました / Refused to start in production: ${violations.join(" / ")}`);
  }
}

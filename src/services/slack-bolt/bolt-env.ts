/**
 * Slack Boltサービス専用の環境変数（DATABASE_URLやPII鍵を持たない）
 * Environment variables for the Slack Bolt service only (no DATABASE_URL or PII key)
 * Variabel lingkungan khusus layanan Slack Bolt (tanpa DATABASE_URL atau kunci PII)
 */
import { z } from "zod";

const boltEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
  // 自社ワークスペース以外からのリクエストを拒否する（空なら照合をスキップ＝開発用）
  // Reject requests from other workspaces (empty skips the check — for local development)
  // Tolak permintaan dari workspace lain (kosong = lewati pengecekan — untuk pengembangan lokal)
  SLACK_ALLOWED_TEAM_ID: z.string().optional().default(""),
  ASSEN_MCP_URL: z.string().url(),
  ASSEN_TOKEN_EXCHANGE_URL: z.string().url(),
  // SA IDトークンのaudience。AssenのGOOGLE_OAUTH_CLIENT_IDと同じ値にする
  // Audience for the SA ID token. Must match Assen's GOOGLE_OAUTH_CLIENT_ID
  // Audience untuk ID token SA. Harus sama dengan GOOGLE_OAUTH_CLIENT_ID Assen
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  // Assen JWTのキャッシュ余裕（秒）。TTLより短く保ち、期限切れ寸前の再利用を避ける
  // Assen JWT cache skew in seconds. Keep shorter than TTL to avoid near-expiry reuse
  // Skew cache JWT Assen dalam detik. Jaga lebih pendek dari TTL agar tidak memakai token hampir kedaluwarsa
  ASSEN_JWT_CACHE_SKEW_SECONDS: z.coerce.number().int().nonnegative().default(300),
});

export type BoltEnv = z.infer<typeof boltEnvSchema>;

let cached: BoltEnv | undefined;

export function loadBoltEnv(): BoltEnv {
  if (cached) {
    return cached;
  }
  const parsed = boltEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
    throw new Error(`Bolt環境変数の検証に失敗しました / Bolt environment validation failed: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

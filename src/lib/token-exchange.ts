/**
 * トークン交換層（自社MVPゲート、docs/registry-readiness-checklist.md G節・B節「OAuthプロバイダの確定方式」(b)案）。
 * 標準的なGoogle IDトークンには`role`/`tenant_id`クレームが無いため、Google Workspaceログイン後にこの薄い層で
 * Google IDトークンを検証し、allowlist（email→role/tenantId）を参照してAssen専用クレーム付きJWTを発行する。
 * 発行したJWTは既存のverifyOAuthBearerToken（src/lib/auth.ts）がそのまま検証できる形（iss/aud/role/tenant_id）にする
 *
 * Token-exchange layer (internal-MVP gate, checklist section G; decision B "OAuth provider" option (b)).
 * Standard Google ID tokens carry no role/tenant_id claims, so after a Google Workspace login this thin layer
 * verifies the Google ID token, looks up an email->role/tenantId allowlist, and issues a JWT carrying Assen's
 * own claims. The issued JWT is shaped (iss/aud/role/tenant_id) so the existing verifyOAuthBearerToken
 * (src/lib/auth.ts) can validate it unchanged
 *
 * Lapisan token exchange (gate MVP internal, bagian G checklist; keputusan B opsi (b) "provider OAuth").
 * Token ID Google standar tidak membawa klaim role/tenant_id, sehingga setelah login Google Workspace, lapisan
 * tipis ini memverifikasi token ID Google, mencari allowlist email->role/tenantId, dan menerbitkan JWT yang
 * membawa klaim milik Assen sendiri.
 */
import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { PRINCIPAL_ROLES } from "./auth.js";
import { loadEnv } from "./env.js";
import { UserInputError } from "./errors.js";
import { logMessage } from "./logger.js";

const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const SIGNING_ALG = "ES256";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const allowlistEntrySchema = z.object({
  email: z.string().email(),
  role: z.enum(PRINCIPAL_ROLES),
  tenantId: z.string().regex(UUID_PATTERN, "tenantIdはUUIDである必要があります / tenantId must be a UUID"),
});
const allowlistSchema = z.array(allowlistEntrySchema);
export type TokenExchangeAllowlistEntry = z.infer<typeof allowlistEntrySchema>;

let cachedGoogleJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getGoogleJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!cachedGoogleJwks) {
    cachedGoogleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));
  }
  return cachedGoogleJwks;
}

/**
 * TOKEN_EXCHANGE_ALLOWLIST_JSONのパース処理をテストから直接検証できるようexportする
 * Exported so TOKEN_EXCHANGE_ALLOWLIST_JSON parsing can be unit-tested directly
 * Diekspor agar parsing TOKEN_EXCHANGE_ALLOWLIST_JSON dapat diuji unit secara langsung
 */
export function parseTokenExchangeAllowlist(json: string): TokenExchangeAllowlistEntry[] {
  return parseAllowlist(json);
}

function parseAllowlist(json: string): TokenExchangeAllowlistEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("TOKEN_EXCHANGE_ALLOWLIST_JSONがJSONとして不正です / TOKEN_EXCHANGE_ALLOWLIST_JSON is not valid JSON");
  }
  const result = allowlistSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `TOKEN_EXCHANGE_ALLOWLIST_JSONの形式が不正です / TOKEN_EXCHANGE_ALLOWLIST_JSON has an invalid shape: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * トークン交換機能全体が有効かどうか（GOOGLE_OAUTH_CLIENT_ID未設定なら無効）
 * Whether the token-exchange feature is enabled at all (disabled when GOOGLE_OAUTH_CLIENT_ID is unset)
 * Apakah fitur token exchange aktif sama sekali (nonaktif saat GOOGLE_OAUTH_CLIENT_ID tidak diatur)
 */
export function isTokenExchangeEnabled(): boolean {
  return loadEnv().GOOGLE_OAUTH_CLIENT_ID.length > 0;
}

// jose v6はKeyLikeを公開型としてexportしないため、generateKeyPairの戻り値から構造的に導出する
// jose v6 no longer exports KeyLike as a public type, so this derives it structurally from generateKeyPair's return type
type SigningPrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

interface SigningKeyPair {
  privateKey: SigningPrivateKey;
  publicJwk: JWK & { kid: string; alg: string; use: string };
}

let cachedSigningKeyPair: SigningKeyPair | undefined;

/**
 * 署名鍵を取得する。TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWKが設定されていればそれをimportし、
 * 未設定ならプロセス内で使い捨て鍵を生成してキャッシュする（本番ではassertProductionSafetyがこれを拒否する）
 * Loads the signing key. Imports TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK when set; otherwise generates and
 * caches an ephemeral in-process key (assertProductionSafety refuses this combination in production)
 */
async function getSigningKeyPair(): Promise<SigningKeyPair> {
  if (cachedSigningKeyPair) {
    return cachedSigningKeyPair;
  }
  const env = loadEnv();
  if (env.TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK) {
    const jwk = JSON.parse(env.TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK) as JWK;
    const privateKey = (await importJWK(jwk, SIGNING_ALG)) as SigningPrivateKey;
    const kid = jwk.kid ?? "assen-token-exchange-1";
    const publicComponents: JWK = { ...jwk };
    delete publicComponents.d;
    cachedSigningKeyPair = { privateKey, publicJwk: { ...publicComponents, kid, alg: SIGNING_ALG, use: "sig" } };
    return cachedSigningKeyPair;
  }

  logMessage(
    "warning",
    "TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK未設定のため使い捨ての署名鍵を生成しました。再起動すると発行済みトークンは全て無効になります。本番ではSecret Managerで固定鍵を設定してください / Generated an ephemeral signing key because TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK is unset; restarting invalidates every previously issued token. Set a persistent key via Secret Manager in production",
  );
  const { privateKey, publicKey } = await generateKeyPair(SIGNING_ALG, { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const kid = randomUUID();
  cachedSigningKeyPair = { privateKey, publicJwk: { ...publicJwk, kid, alg: SIGNING_ALG, use: "sig" } };
  return cachedSigningKeyPair;
}

/**
 * /oauth/jwks.json（OAUTH_JWKS_URIが自身を指す場合の公開鍵配布先）が返すJWKSを組み立てる
 * Builds the JWKS served at /oauth/jwks.json (the endpoint OAUTH_JWKS_URI should point to for this feature)
 * Membangun JWKS yang disajikan di /oauth/jwks.json (endpoint yang seharusnya dituju OAUTH_JWKS_URI untuk fitur ini)
 */
export async function getTokenExchangeJwks(): Promise<{ keys: JWK[] }> {
  if (!isTokenExchangeEnabled()) {
    return { keys: [] };
  }
  const { publicJwk } = await getSigningKeyPair();
  return { keys: [publicJwk] };
}

export interface TokenExchangeResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

/**
 * Google IDトークンを検証し、allowlistに登録済みのemailであればAssen専用クレーム付きJWTを発行する
 * Verifies a Google ID token and, when its email is on the allowlist, issues a JWT carrying Assen's own claims
 * Memverifikasi token ID Google, dan jika emailnya ada di allowlist, menerbitkan JWT yang membawa klaim milik Assen
 */
export async function exchangeGoogleIdTokenForAssenToken(
  googleIdToken: string,
  // テスト専用: 実ネットワークJWKS取得の代わりにcreateLocalJWKSetを注入できるようにする（test/oauth-auth.test.tsと同じパターン）
  // Test-only: allows injecting createLocalJWKSet instead of the real network JWKS fetch (same pattern as test/oauth-auth.test.ts)
  overrideGoogleJwks?: JWTVerifyGetKey,
): Promise<TokenExchangeResult> {
  const env = loadEnv();
  if (!isTokenExchangeEnabled()) {
    throw new UserInputError(
      "トークン交換は無効です / Token exchange is disabled",
      "サーバー管理者にGOOGLE_OAUTH_CLIENT_IDの設定を依頼してください / Ask the server administrator to set GOOGLE_OAUTH_CLIENT_ID",
    );
  }
  if (!env.OAUTH_AUDIENCE) {
    throw new Error("OAUTH_AUDIENCEが未設定です（発行するJWTのaudienceに使うため必須） / OAUTH_AUDIENCE is required to issue the JWT's audience claim");
  }

  let googlePayload;
  try {
    const { payload } = await jwtVerify(googleIdToken, overrideGoogleJwks ?? getGoogleJwks(), {
      issuer: GOOGLE_ISSUERS,
      audience: env.GOOGLE_OAUTH_CLIENT_ID,
    });
    googlePayload = payload;
  } catch {
    throw new UserInputError(
      "Google IDトークンの検証に失敗しました / Google ID token verification failed",
      "有効なGoogle IDトークンを取得し直してください / Please obtain a fresh Google ID token",
    );
  }

  if (googlePayload.email_verified !== true || typeof googlePayload.email !== "string") {
    throw new UserInputError(
      "Google IDトークンのemailが確認されていません / The Google ID token's email is not verified",
      "email_verified=trueのGoogleアカウントでログインしてください / Please log in with a Google account where email_verified=true",
    );
  }
  const email = googlePayload.email.toLowerCase();

  const allowlist = parseAllowlist(env.TOKEN_EXCHANGE_ALLOWLIST_JSON);
  const entry = allowlist.find((candidate) => candidate.email.toLowerCase() === email);
  if (!entry) {
    logMessage(
      "warning",
      "allowlist未登録のGoogleアカウントからのトークン交換要求を拒否しました / rejected a token-exchange request from a Google account that is not on the allowlist",
      { email },
    );
    throw new UserInputError(
      "このGoogleアカウントはAssenの利用が許可されていません / This Google account is not authorized to use Assen",
      "管理者（壁）にallowlistへの追加を依頼してください / Ask the admin to add this account to the allowlist",
    );
  }

  const { privateKey, publicJwk } = await getSigningKeyPair();
  const ttlSeconds = env.TOKEN_EXCHANGE_TOKEN_TTL_SECONDS;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const accessToken = await new SignJWT({
    [env.OAUTH_ROLE_CLAIM]: entry.role,
    [env.OAUTH_TENANT_CLAIM]: entry.tenantId,
  })
    .setProtectedHeader({ alg: SIGNING_ALG, kid: publicJwk.kid })
    .setSubject(email)
    .setIssuer(env.TOKEN_EXCHANGE_ISSUER)
    .setAudience(env.OAUTH_AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttlSeconds)
    .sign(privateKey);

  logMessage("info", "トークン交換に成功しました / token exchange succeeded", { email, role: entry.role, tenantId: entry.tenantId });

  return { accessToken, tokenType: "Bearer", expiresIn: ttlSeconds };
}

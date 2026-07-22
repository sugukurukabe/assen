/**
 * 認証主体（principal）の導出シーム。approved_by等は常にここから取得し、ツール入力からは受け取らない
 * Seam for deriving the authenticated principal. approved_by etc. must always come from here, never from tool input
 * Seam untuk menurunkan principal terautentikasi. approved_by dll. harus selalu berasal dari sini, bukan dari input tool
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { loadEnv, type AssenEnv } from "./env.js";

export const PRINCIPAL_ROLES = ["requester", "approver", "admin", "system"] as const;
export type PrincipalRole = (typeof PRINCIPAL_ROLES)[number];

export interface AuthenticatedPrincipal {
  principalId: string;
  role: PrincipalRole;
  authMethod: "local_fixed_token" | "oauth";
  tenantId: string;
}

export type OAuthScope = "compliance:read" | "compliance:write" | "compliance:approve";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPrincipalRole(value: unknown): value is PrincipalRole {
  return typeof value === "string" && (PRINCIPAL_ROLES as readonly string[]).includes(value);
}

let cachedJwks: JWTVerifyGetKey | undefined;
let cachedJwksUri: string | undefined;

/**
 * OAUTH_JWKS_URIのJWKSを取得するgetterをキャッシュする（リクエスト毎にネットワーク往復しないよう、joseのremote JWKS cacheに委譲する）
 * Caches the getter that fetches the JWKS at OAUTH_JWKS_URI (delegates to jose's remote-JWKS cache so we don't round-trip per request)
 * Menyimpan cache getter yang mengambil JWKS di OAUTH_JWKS_URI (mendelegasikan ke cache JWKS remote milik jose agar tidak round-trip per permintaan)
 */
function getJwks(env: AssenEnv): JWTVerifyGetKey {
  if (!env.OAUTH_JWKS_URI) {
    throw new Error("OAUTH_JWKS_URIが未設定です / OAUTH_JWKS_URI is not set");
  }
  if (!cachedJwks || cachedJwksUri !== env.OAUTH_JWKS_URI) {
    cachedJwks = createRemoteJWKSet(new URL(env.OAUTH_JWKS_URI));
    cachedJwksUri = env.OAUTH_JWKS_URI;
  }
  return cachedJwks;
}

export type OAuthClaimConfig = Pick<AssenEnv, "OAUTH_ISSUER" | "OAUTH_AUDIENCE" | "OAUTH_ROLE_CLAIM" | "OAUTH_TENANT_CLAIM">;

/**
 * OAuth2 Bearerトークンを検証しprincipalへ変換する。issuer/audienceの検証は必須（token passthrough禁止、設計書§2.4・§7）。
 * role/tenantIdはIdP側のカスタムクレームから取得する（クレーム名はOAUTH_ROLE_CLAIM/OAUTH_TENANT_CLAIMで設定）
 * Verifies an OAuth2 bearer token and maps it to a principal. issuer/audience validation is mandatory (no token
 * passthrough, design doc §2.4/§7). role/tenantId come from IdP custom claims (names configured via
 * OAUTH_ROLE_CLAIM/OAUTH_TENANT_CLAIM)
 * Memverifikasi token bearer OAuth2 dan memetakannya ke principal. Validasi issuer/audience wajib (tidak boleh
 * token passthrough, dokumen desain §2.4/§7). role/tenantId berasal dari klaim khusus IdP (nama klaim
 * dikonfigurasi via OAUTH_ROLE_CLAIM/OAUTH_TENANT_CLAIM)
 */
export async function verifyOAuthBearerToken(
  bearerToken: string,
  jwks: JWTVerifyGetKey,
  config: OAuthClaimConfig,
): Promise<AuthenticatedPrincipal> {
  if (!config.OAUTH_ISSUER || !config.OAUTH_AUDIENCE) {
    throw new Error("OAUTH_ISSUER/OAUTH_AUDIENCEが未設定です / OAUTH_ISSUER/OAUTH_AUDIENCE are not set");
  }

  const { payload } = await jwtVerify(bearerToken, jwks, {
    issuer: config.OAUTH_ISSUER,
    audience: config.OAUTH_AUDIENCE,
  });

  const roleValue = payload[config.OAUTH_ROLE_CLAIM];
  if (!isPrincipalRole(roleValue)) {
    throw new Error(
      `OAuthトークンのroleクレーム(${config.OAUTH_ROLE_CLAIM})が不正です / invalid role claim (${config.OAUTH_ROLE_CLAIM})`,
    );
  }

  const tenantValue = payload[config.OAUTH_TENANT_CLAIM];
  if (typeof tenantValue !== "string" || !UUID_PATTERN.test(tenantValue)) {
    throw new Error(
      `OAuthトークンのtenantクレーム(${config.OAUTH_TENANT_CLAIM})はUUIDである必要があります / tenant claim (${config.OAUTH_TENANT_CLAIM}) must be a UUID`,
    );
  }

  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new Error("OAuthトークンにsubクレームがありません / OAuth token is missing the sub claim");
  }

  return {
    principalId: subject,
    role: roleValue,
    authMethod: "oauth",
    tenantId: tenantValue,
  };
}

/**
 * リクエストコンテキスト（transport層から渡されるトークン等）から認証主体を導出する
 * Derives the authenticated principal from the request context (token supplied by the transport layer)
 * Menurunkan principal terautentikasi dari konteks permintaan (token yang disediakan oleh lapisan transport)
 */
export async function resolvePrincipal(bearerToken: string | undefined): Promise<AuthenticatedPrincipal> {
  const env = loadEnv();

  if (env.AUTH_MODE === "local_fixed_token") {
    if (!env.AUTH_LOCAL_TOKEN || bearerToken !== env.AUTH_LOCAL_TOKEN) {
      throw new Error("認証に失敗しました（ローカル固定トークン不一致） / Authentication failed (local fixed token mismatch)");
    }
    return {
      principalId: "local-dev-principal",
      role: "admin",
      authMethod: "local_fixed_token",
      tenantId: "00000000-0000-0000-0000-000000000001",
    };
  }

  if (!bearerToken) {
    throw new Error("Authorizationヘッダーが必要です / Authorization header is required");
  }
  return verifyOAuthBearerToken(bearerToken, getJwks(env), env);
}

/**
 * principalが必要なscopeを持つか検証する
 * Verifies that a principal holds the required scope
 * Memverifikasi bahwa principal memiliki scope yang diperlukan
 */
export function assertScope(principal: AuthenticatedPrincipal, requiredRole: AuthenticatedPrincipal["role"][]): void {
  if (!requiredRole.includes(principal.role)) {
    throw new Error(`権限不足です（必要role: ${requiredRole.join(",")}） / Insufficient permission (required role: ${requiredRole.join(",")})`);
  }
}

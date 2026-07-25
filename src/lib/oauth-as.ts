/**
 * Claude Connectors向けOAuth Authorization Server（DCR + PKCE + refresh）。
 * Google Workspaceログイン後、既存allowlistを通したAssen JWTをClaudeに返す。
 *
 * OAuth Authorization Server for Claude Connectors (DCR + PKCE + refresh).
 * After Google Workspace login, returns an Assen JWT gated by the existing allowlist.
 *
 * OAuth Authorization Server untuk Claude Connectors (DCR + PKCE + refresh).
 * Setelah login Google Workspace, mengembalikan JWT Assen yang dijaga allowlist yang sudah ada.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "../db/schema/index.js";
import { oauthAuthCodes, oauthClients, oauthRefreshTokens } from "../db/schema/oauth.js";
import { loadEnv, type AssenEnv } from "./env.js";
import { UserInputError } from "./errors.js";
import {
  issueAssenTokenForAllowlistedPrincipal,
  verifyGoogleIdTokenForAllowlistedPrincipal,
  type AllowlistedGooglePrincipal,
} from "./token-exchange.js";

type Db = NodePgDatabase<typeof schema>;

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pkceS256(value: string): string {
  return base64url(createHash("sha256").update(value).digest());
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function getBaseUrlFromRequest(req: { headers: Record<string, string | string[] | undefined> }, env: Pick<AssenEnv, "PORT">): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ?? "http";
  const forwardedHost = req.headers.host;
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? `localhost:${env.PORT}`;
  return `${protocol}://${host}`;
}

export function buildProtectedResourceMetadata(baseUrl: string): Record<string, unknown> {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["assen"],
    resource_documentation: `${baseUrl}/.well-known/mcp.json`,
  };
}

export function buildAuthorizationServerMetadata(baseUrl: string, env: AssenEnv): Record<string, unknown> {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    jwks_uri: `${baseUrl}/oauth/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["assen"],
    service_documentation: env.SERVER_CARD_REPOSITORY_URL || `${baseUrl}/.well-known/mcp.json`,
  };
}

const registerClientSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  client_name: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
});

export async function registerOAuthClient(db: Db, body: unknown): Promise<Record<string, unknown>> {
  const parsed = registerClientSchema.parse(body);
  const clientId = `assen_${randomUUID()}`;
  const grantTypes = parsed.grant_types ?? ["authorization_code", "refresh_token"];
  const responseTypes = parsed.response_types ?? ["code"];

  await db.insert(oauthClients).values({
    clientId,
    clientName: parsed.client_name,
    redirectUris: parsed.redirect_uris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod: "none",
    clientMetadata: parsed,
  });

  return {
    client_id: clientId,
    client_name: parsed.client_name,
    redirect_uris: parsed.redirect_uris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: "none",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

function redirectUriMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    return false;
  }
  if ((url.hostname !== "localhost" && url.hostname !== "127.0.0.1") || url.pathname !== "/callback") {
    return false;
  }
  return registered.some((candidate) => {
    try {
      const registeredUrl = new URL(candidate);
      return (
        (registeredUrl.hostname === "localhost" || registeredUrl.hostname === "127.0.0.1") &&
        registeredUrl.pathname === "/callback"
      );
    } catch {
      return false;
    }
  });
}

export async function buildAuthorizeRedirect(db: Db, baseUrl: string, query: URLSearchParams): Promise<string> {
  const clientId = query.get("client_id");
  const redirectUri = query.get("redirect_uri");
  const responseType = query.get("response_type");
  const codeChallenge = query.get("code_challenge");
  const codeChallengeMethod = query.get("code_challenge_method");
  const requestedState = query.get("state") ?? undefined;
  const scope = query.get("scope") || "assen";

  if (!clientId || !redirectUri || responseType !== "code" || !codeChallenge || codeChallengeMethod !== "S256") {
    throw new UserInputError(
      "OAuth authorizeリクエストが不正です / Invalid OAuth authorize request",
      "response_type=code、redirect_uri、client_id、code_challenge_method=S256を指定してください",
    );
  }

  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!client || !redirectUriMatches(client.redirectUris as string[], redirectUri)) {
    throw new UserInputError(
      "未登録のOAuth clientまたはredirect_uriです / Unregistered OAuth client or redirect_uri",
      "Claude Connectorから再接続してください / Reconnect from Claude Connector",
    );
  }

  const env = loadEnv();
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID/SECRETが未設定です / GOOGLE_OAUTH_CLIENT_ID/SECRET are required");
  }

  const googleState = randomToken(24);
  await db.insert(oauthAuthCodes).values({
    clientId,
    redirectUri,
    requestedState,
    googleState,
    codeChallenge,
    codeChallengeMethod,
    scope,
    expiresAt: addMs(new Date(), GOOGLE_STATE_TTL_MS),
  });

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  googleAuthUrl.searchParams.set("redirect_uri", `${baseUrl}/oauth/callback`);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("state", googleState);
  googleAuthUrl.searchParams.set("prompt", "select_account");
  return googleAuthUrl.toString();
}

async function exchangeGoogleCodeForIdToken(code: string, baseUrl: string): Promise<string> {
  const env = loadEnv();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${baseUrl}/oauth/callback`,
    }),
  });
  const body = (await response.json()) as { id_token?: unknown; error?: unknown };
  if (!response.ok || typeof body.id_token !== "string") {
    const reason = typeof body.error === "string" ? body.error : `status_${response.status}`;
    throw new UserInputError(
      "Google OAuthコード交換に失敗しました / Google OAuth code exchange failed",
      `Google callback設定を確認してください / Check the Google callback settings: ${reason}`,
    );
  }
  return body.id_token;
}

export async function handleGoogleOAuthCallback(db: Db, baseUrl: string, query: URLSearchParams): Promise<string> {
  const code = query.get("code");
  const googleState = query.get("state");
  if (!code || !googleState) {
    throw new UserInputError("Google callbackが不正です / Invalid Google callback", "code/stateが必要です");
  }

  const [pending] = await db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.googleState, googleState)).limit(1);
  if (!pending || pending.consumedAt || pending.expiresAt.getTime() < Date.now()) {
    throw new UserInputError("OAuth stateが無効または期限切れです / OAuth state is invalid or expired", "Claudeから接続をやり直してください");
  }

  const googleIdToken = await exchangeGoogleCodeForIdToken(code, baseUrl);
  const principal = await verifyGoogleIdTokenForAllowlistedPrincipal(googleIdToken);
  const authorizationCode = randomToken(32);

  const redirect = new URL(pending.redirectUri);
  redirect.searchParams.set("code", authorizationCode);
  if (pending.requestedState) {
    redirect.searchParams.set("state", pending.requestedState);
  }

  await db
    .update(oauthAuthCodes)
    .set({
      codeHash: sha256(authorizationCode),
      principalEmail: principal.email,
      principalRole: principal.role,
      tenantId: principal.tenantId,
      expiresAt: addMs(new Date(), AUTH_CODE_TTL_MS),
      updatedAt: new Date(),
    })
    .where(eq(oauthAuthCodes.id, pending.id));

  return redirect.toString();
}

export async function exchangeAuthorizationCode(db: Db, form: URLSearchParams): Promise<Record<string, unknown>> {
  const code = form.get("code");
  const clientId = form.get("client_id");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");
  if (!code || !clientId || !redirectUri || !codeVerifier) {
    throw new UserInputError("tokenリクエストが不正です / Invalid token request", "code/client_id/redirect_uri/code_verifierが必要です");
  }

  const [row] = await db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, sha256(code))).limit(1);
  if (
    !row ||
    row.clientId !== clientId ||
    row.redirectUri !== redirectUri ||
    row.consumedAt ||
    row.expiresAt.getTime() < Date.now() ||
    pkceS256(codeVerifier) !== row.codeChallenge ||
    !row.principalEmail ||
    !row.principalRole ||
    !row.tenantId
  ) {
    throw new UserInputError("authorization_codeが無効です / authorization_code is invalid", "Claudeから再認証してください");
  }

  await db.update(oauthAuthCodes).set({ consumedAt: new Date(), updatedAt: new Date() }).where(eq(oauthAuthCodes.id, row.id));

  return issueOAuthTokens(db, {
    clientId,
    principal: { email: row.principalEmail, role: row.principalRole as AllowlistedGooglePrincipal["role"], tenantId: row.tenantId },
    scope: row.scope,
    rotationCounter: 0,
  });
}

async function issueOAuthTokens(
  db: Db,
  input: { clientId: string; principal: AllowlistedGooglePrincipal; scope: string; rotationCounter: number },
): Promise<Record<string, unknown>> {
  const assenToken = await issueAssenTokenForAllowlistedPrincipal(input.principal);
  const refreshToken = randomToken(32);
  await db.insert(oauthRefreshTokens).values({
    tokenHash: sha256(refreshToken),
    clientId: input.clientId,
    principalEmail: input.principal.email,
    principalRole: input.principal.role,
    tenantId: input.principal.tenantId,
    scope: input.scope,
    expiresAt: addMs(new Date(), REFRESH_TOKEN_TTL_MS),
    rotationCounter: input.rotationCounter,
  });

  return {
    access_token: assenToken.accessToken,
    token_type: "Bearer",
    expires_in: assenToken.expiresIn,
    refresh_token: refreshToken,
    scope: input.scope,
  };
}

export async function rotateRefreshToken(db: Db, form: URLSearchParams): Promise<Record<string, unknown>> {
  const refreshToken = form.get("refresh_token");
  const clientId = form.get("client_id");
  if (!refreshToken || !clientId) {
    throw new UserInputError("refresh_tokenリクエストが不正です / Invalid refresh_token request", "refresh_token/client_idが必要です");
  }

  const [row] = await db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.tokenHash, sha256(refreshToken)))
    .limit(1);
  if (!row || row.clientId !== clientId || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    throw new UserInputError("refresh_tokenが無効です / refresh_token is invalid", "Claudeから再ログインしてください");
  }

  await db.update(oauthRefreshTokens).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(oauthRefreshTokens.id, row.id));
  return issueOAuthTokens(db, {
    clientId,
    principal: { email: row.principalEmail, role: row.principalRole as AllowlistedGooglePrincipal["role"], tenantId: row.tenantId },
    scope: row.scope,
    rotationCounter: row.rotationCounter + 1,
  });
}

export async function handleOAuthTokenRequest(db: Db, form: URLSearchParams): Promise<Record<string, unknown>> {
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    return exchangeAuthorizationCode(db, form);
  }
  if (grantType === "refresh_token") {
    return rotateRefreshToken(db, form);
  }
  throw new UserInputError("未対応のgrant_typeです / Unsupported grant_type", "authorization_codeまたはrefresh_tokenを指定してください");
}

export function getOpenRedirectErrorUrl(redirectUri: string, error: string, state?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) {
    url.searchParams.set("state", state);
  }
  return url.toString();
}

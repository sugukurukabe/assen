/**
 * 自社MVPゲート検証（docs/registry-readiness-checklist.md G節・B節「OAuthプロバイダの確定方式」(b)案）：
 * トークン交換層（Google IDトークン→Assen audience JWT）の単体テスト。実ネットワークのGoogle JWKS取得は使わず、
 * test/oauth-auth.test.tsと同じパターン（jose の createLocalJWKSet）でオフラインに検証する。
 * このファイルはGOOGLE_OAUTH_CLIENT_IDを設定した「トークン交換が有効な」状態を検証する
 * （無効時の挙動はtest/token-exchange-disabled.test.tsで検証。env.tsのloadEnvは初回呼び出しでキャッシュされるため、
 * 有効/無効は別ファイルに分けて各ファイルの最初のloadEnv呼び出し前に環境変数を確定させている）
 *
 * Internal-MVP gate verification (checklist section G; decision B option (b) "OAuth provider"): unit tests for
 * the token-exchange layer (Google ID token -> Assen audience JWT). Verifies fully offline, without a real
 * network Google JWKS fetch, using the same pattern as test/oauth-auth.test.ts (jose's createLocalJWKSet). This
 * file covers the "token exchange enabled" state (GOOGLE_OAUTH_CLIENT_ID set); the disabled state is covered by
 * test/token-exchange-disabled.test.ts (loadEnv caches on first call, so enabled/disabled live in separate files
 * with env vars fixed before either file's first loadEnv call)
 */
import { randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyOAuthBearerToken } from "../src/lib/auth.js";
import { exchangeGoogleIdTokenForAssenToken, getTokenExchangeJwks, isTokenExchangeEnabled, parseTokenExchangeAllowlist } from "../src/lib/token-exchange.js";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
const GOOGLE_KEY_ID = "google-test-key-1";
const ALLOWED_EMAIL = "kabe@sugu-kuru.co.jp";
const ALLOWED_TENANT_ID = randomUUID();

let googlePrivateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let googleJwks: JWTVerifyGetKey;

async function signFakeGoogleIdToken(
  claims: Record<string, unknown>,
  overrides?: { issuer?: string; audience?: string },
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: GOOGLE_KEY_ID })
    .setIssuer(overrides?.issuer ?? GOOGLE_ISSUER)
    .setAudience(overrides?.audience ?? GOOGLE_CLIENT_ID)
    .setSubject("google-subject-id")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(googlePrivateKey);
}

beforeAll(async () => {
  // env.loadEnv()を最初に呼ぶより前に、トークン交換を有効化する環境変数を確定させる
  // Fixes the token-exchange-enabling env vars before the first call to env.loadEnv()
  process.env.GOOGLE_OAUTH_CLIENT_ID = GOOGLE_CLIENT_ID;
  process.env.OAUTH_AUDIENCE = "assen";
  process.env.OAUTH_ROLE_CLAIM = "role";
  process.env.OAUTH_TENANT_CLAIM = "tenant_id";
  process.env.TOKEN_EXCHANGE_ISSUER = "https://assen.test/token-exchange";
  process.env.TOKEN_EXCHANGE_ALLOWLIST_JSON = JSON.stringify([
    { email: ALLOWED_EMAIL, role: "requester", tenantId: ALLOWED_TENANT_ID },
  ]);

  const { privateKey, publicKey } = await generateKeyPair("ES256");
  googlePrivateKey = privateKey;
  const publicJwk = await exportJWK(publicKey);
  googleJwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: GOOGLE_KEY_ID, alg: "ES256", use: "sig" }] });
});

describe("トークン交換層（有効時） / token-exchange layer (enabled)", () => {
  it("isTokenExchangeEnabledはGOOGLE_OAUTH_CLIENT_ID設定時にtrueを返す / isTokenExchangeEnabled returns true once GOOGLE_OAUTH_CLIENT_ID is set", () => {
    expect(isTokenExchangeEnabled()).toBe(true);
  });

  it("allowlist登録済みemailのGoogle IDトークンをAssen audience JWTへ交換し、既存のverifyOAuthBearerTokenで検証できる / exchanges an allowlisted Google ID token for an Assen-audience JWT that the existing verifyOAuthBearerToken can validate", async () => {
    const googleIdToken = await signFakeGoogleIdToken({ email: ALLOWED_EMAIL, email_verified: true });
    const result = await exchangeGoogleIdTokenForAssenToken(googleIdToken, googleJwks);

    expect(result.tokenType).toBe("Bearer");
    expect(result.expiresIn).toBeGreaterThan(0);

    const issuedJwks = await getTokenExchangeJwks();
    expect(issuedJwks.keys).toHaveLength(1);
    const localJwks = createLocalJWKSet(issuedJwks);

    const principal = await verifyOAuthBearerToken(result.accessToken, localJwks, {
      OAUTH_ISSUER: "https://assen.test/token-exchange",
      OAUTH_AUDIENCE: "assen",
      OAUTH_ROLE_CLAIM: "role",
      OAUTH_TENANT_CLAIM: "tenant_id",
    });

    expect(principal).toEqual({
      principalId: ALLOWED_EMAIL,
      role: "requester",
      authMethod: "oauth",
      tenantId: ALLOWED_TENANT_ID,
    });
  });

  it("allowlist未登録のemailは拒否する / rejects an email that is not on the allowlist", async () => {
    const googleIdToken = await signFakeGoogleIdToken({ email: "not-allowed@example.com", email_verified: true });

    await expect(exchangeGoogleIdTokenForAssenToken(googleIdToken, googleJwks)).rejects.toThrow(/許可されていません|not authorized/);
  });

  it("email_verified=falseのトークンは拒否する / rejects a token with email_verified=false", async () => {
    const googleIdToken = await signFakeGoogleIdToken({ email: ALLOWED_EMAIL, email_verified: false });

    await expect(exchangeGoogleIdTokenForAssenToken(googleIdToken, googleJwks)).rejects.toThrow(/emailが確認|email is not verified/);
  });

  it("audienceが不一致のGoogle IDトークンは拒否する / rejects a Google ID token with a mismatched audience", async () => {
    const googleIdToken = await signFakeGoogleIdToken(
      { email: ALLOWED_EMAIL, email_verified: true },
      { audience: "some-other-google-client-id" },
    );

    await expect(exchangeGoogleIdTokenForAssenToken(googleIdToken, googleJwks)).rejects.toThrow(/検証に失敗|verification failed/);
  });

  it("parseTokenExchangeAllowlistは不正なJSON・不正な形式を拒否する / parseTokenExchangeAllowlist rejects invalid JSON and invalid shapes", () => {
    expect(() => parseTokenExchangeAllowlist("not json")).toThrow();
    expect(() => parseTokenExchangeAllowlist(JSON.stringify([{ email: "x@example.com", role: "not-a-role", tenantId: randomUUID() }]))).toThrow();
    expect(() => parseTokenExchangeAllowlist(JSON.stringify([{ email: "x@example.com", role: "requester", tenantId: "not-a-uuid" }]))).toThrow();

    const valid = parseTokenExchangeAllowlist(JSON.stringify([{ email: "x@example.com", role: "requester", tenantId: ALLOWED_TENANT_ID }]));
    expect(valid).toEqual([{ email: "x@example.com", role: "requester", tenantId: ALLOWED_TENANT_ID }]);
  });
});

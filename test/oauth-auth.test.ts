/**
 * OAuth2 Bearer検証の単体テスト：audience/issuer検証・role/tenantクレームマッピングが正しく機能することを確認する。
 * ネットワークJWKS取得は使わず、jose の createLocalJWKSet で完全にオフラインに検証する
 * Unit tests for OAuth2 bearer verification: confirms audience/issuer validation and role/tenant claim mapping work.
 * Uses jose's createLocalJWKSet to verify fully offline, without a network JWKS fetch
 * Unit test untuk verifikasi bearer OAuth2: memastikan validasi audience/issuer dan pemetaan klaim role/tenant berfungsi.
 * Menggunakan createLocalJWKSet milik jose untuk verifikasi sepenuhnya offline, tanpa fetch JWKS via network
 */
import { randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyOAuthBearerToken, type OAuthClaimConfig } from "../src/lib/auth.js";

const ISSUER = "https://idp.example.com";
const AUDIENCE = "assen";
const KEY_ID = "test-key-1";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let jwks: JWTVerifyGetKey;

const baseConfig: OAuthClaimConfig = {
  OAUTH_ISSUER: ISSUER,
  OAUTH_AUDIENCE: AUDIENCE,
  OAUTH_ROLE_CLAIM: "role",
  OAUTH_TENANT_CLAIM: "tenant_id",
};

async function signToken(claims: Record<string, unknown>, overrides?: { issuer?: string; audience?: string }): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuer(overrides?.issuer ?? ISSUER)
    .setAudience(overrides?.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
}

beforeAll(async () => {
  const { privateKey: sk, publicKey: pk } = await generateKeyPair("ES256");
  privateKey = sk;
  const publicJwk = await exportJWK(pk);
  jwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KEY_ID, alg: "ES256", use: "sig" }] });
});

describe("verifyOAuthBearerToken", () => {
  it("正当なトークンをprincipalへ変換する / maps a valid token to a principal", async () => {
    const tenantId = randomUUID();
    const token = await signToken({ sub: "user-123", role: "approver", tenant_id: tenantId });

    const principal = await verifyOAuthBearerToken(token, jwks, baseConfig);

    expect(principal).toEqual({
      principalId: "user-123",
      role: "approver",
      authMethod: "oauth",
      tenantId,
    });
  });

  it("audienceが不一致なら拒否する（token passthrough禁止） / rejects a mismatched audience (no token passthrough)", async () => {
    const token = await signToken(
      { sub: "user-123", role: "requester", tenant_id: randomUUID() },
      { audience: "some-other-service" },
    );
    await expect(verifyOAuthBearerToken(token, jwks, baseConfig)).rejects.toThrow();
  });

  it("issuerが不一致なら拒否する / rejects a mismatched issuer", async () => {
    const token = await signToken(
      { sub: "user-123", role: "requester", tenant_id: randomUUID() },
      { issuer: "https://untrusted-idp.example.com" },
    );
    await expect(verifyOAuthBearerToken(token, jwks, baseConfig)).rejects.toThrow();
  });

  it("roleクレームが未対応の値なら拒否する / rejects an unsupported role claim value", async () => {
    const token = await signToken({ sub: "user-123", role: "super-admin", tenant_id: randomUUID() });
    await expect(verifyOAuthBearerToken(token, jwks, baseConfig)).rejects.toThrow(/role/);
  });

  it("tenantクレームがUUIDでなければ拒否する / rejects a tenant claim that is not a UUID", async () => {
    const token = await signToken({ sub: "user-123", role: "requester", tenant_id: "not-a-uuid" });
    await expect(verifyOAuthBearerToken(token, jwks, baseConfig)).rejects.toThrow(/tenant/);
  });

  it("subクレームが欠落していれば拒否する / rejects a token missing the sub claim", async () => {
    const token = await signToken({ role: "requester", tenant_id: randomUUID() });
    await expect(verifyOAuthBearerToken(token, jwks, baseConfig)).rejects.toThrow(/sub/);
  });

  it("OAUTH_ROLE_CLAIM/OAUTH_TENANT_CLAIMのカスタムクレーム名を使える / honors custom claim names via OAUTH_ROLE_CLAIM/OAUTH_TENANT_CLAIM", async () => {
    const tenantId = randomUUID();
    const token = await signToken({ sub: "user-456", assenRole: "admin", assenTenant: tenantId });
    const customConfig: OAuthClaimConfig = { ...baseConfig, OAUTH_ROLE_CLAIM: "assenRole", OAUTH_TENANT_CLAIM: "assenTenant" };

    const principal = await verifyOAuthBearerToken(token, jwks, customConfig);

    expect(principal.role).toBe("admin");
    expect(principal.tenantId).toBe(tenantId);
  });
});

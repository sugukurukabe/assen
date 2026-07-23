/**
 * 本番運用ハードニングの単体テスト：production起動ガードとリクエストボディ上限のふるまいを確認する
 * Unit tests for the production hardening pass: verifies the production startup guard and request-body size limit
 * Unit test untuk hardening produksi: memverifikasi guard startup production dan batas ukuran body permintaan
 */
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { assertProductionSafety, type AssenEnv } from "../src/lib/env.js";
import { readJsonBody } from "../src/lib/http-body.js";
import { PayloadTooLargeError } from "../src/lib/errors.js";

function baseEnv(overrides: Partial<AssenEnv>): AssenEnv {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://example",
    MIGRATION_DATABASE_URL: "",
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_ACCESS_KEY: "key",
    STORAGE_SECRET_KEY: "secret",
    STORAGE_BUCKET: "bucket",
    PII_ENCRYPTION_KEY: "",
    PORT: 8080,
    AUTH_MODE: "local_fixed_token",
    AUTH_LOCAL_TOKEN: "",
    OAUTH_ISSUER: "",
    OAUTH_AUDIENCE: "",
    OAUTH_JWKS_URI: "",
    OAUTH_ROLE_CLAIM: "role",
    OAUTH_TENANT_CLAIM: "tenant_id",
    LLM_API_KEY: "",
    MAX_REQUEST_BODY_BYTES: 20 * 1024 * 1024,
    DB_POOL_MAX: 10,
    DB_POOL_IDLE_TIMEOUT_MS: 30_000,
    DB_POOL_CONNECTION_TIMEOUT_MS: 5_000,
    CORS_ALLOWED_ORIGINS: "",
    SERVER_CARD_REPOSITORY_URL: "",
    SERVER_CARD_CONTACT_URL: "",
    SLACK_BOT_TOKEN: "",
    SLACK_APPROVAL_CHANNEL_ID: "",
    GOOGLE_OAUTH_CLIENT_ID: "",
    TOKEN_EXCHANGE_ALLOWLIST_JSON: "[]",
    TOKEN_EXCHANGE_ISSUER: "https://assen.internal/token-exchange",
    TOKEN_EXCHANGE_TOKEN_TTL_SECONDS: 3600,
    TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK: "",
    ...overrides,
  };
}

describe("assertProductionSafety", () => {
  it("development/testでは何も検証しない / performs no checks in development/test", () => {
    expect(() => assertProductionSafety(baseEnv({ NODE_ENV: "development" }))).not.toThrow();
    expect(() => assertProductionSafety(baseEnv({ NODE_ENV: "test" }))).not.toThrow();
  });

  it("productionでAUTH_MODE=local_fixed_tokenなら起動を拒否する / refuses to start in production with AUTH_MODE=local_fixed_token", () => {
    expect(() =>
      assertProductionSafety(
        baseEnv({
          NODE_ENV: "production",
          AUTH_MODE: "oauth",
          PII_ENCRYPTION_KEY: "a".repeat(44),
          OAUTH_ISSUER: "https://idp.example.com",
          OAUTH_AUDIENCE: "assen",
          OAUTH_JWKS_URI: "https://idp.example.com/.well-known/jwks.json",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertProductionSafety(baseEnv({ NODE_ENV: "production", AUTH_MODE: "local_fixed_token", PII_ENCRYPTION_KEY: "a".repeat(44) })),
    ).toThrow(/AUTH_MODE/);
  });

  it("productionでPII_ENCRYPTION_KEY未設定なら起動を拒否する / refuses to start in production without PII_ENCRYPTION_KEY", () => {
    expect(() =>
      assertProductionSafety(
        baseEnv({
          NODE_ENV: "production",
          AUTH_MODE: "oauth",
          PII_ENCRYPTION_KEY: "",
          OAUTH_ISSUER: "https://idp.example.com",
          OAUTH_AUDIENCE: "assen",
          OAUTH_JWKS_URI: "https://idp.example.com/.well-known/jwks.json",
        }),
      ),
    ).toThrow(/PII_ENCRYPTION_KEY/);
  });

  it("productionでAUTH_MODE=oauthかつOAUTH_*未設定なら起動を拒否する / refuses to start in production when AUTH_MODE=oauth but OAUTH_* is unset", () => {
    expect(() =>
      assertProductionSafety(baseEnv({ NODE_ENV: "production", AUTH_MODE: "oauth", PII_ENCRYPTION_KEY: "a".repeat(44) })),
    ).toThrow(/OAUTH_ISSUER/);
  });
});

function bodyStream(bytes: Buffer): IncomingMessage {
  return Readable.from([bytes]) as unknown as IncomingMessage;
}

describe("readJsonBody", () => {
  it("上限以下のボディは正しくパースする / parses bodies within the limit", async () => {
    const payload = JSON.stringify({ hello: "world" });
    const result = await readJsonBody(bodyStream(Buffer.from(payload, "utf8")), 1024);
    expect(result).toEqual({ hello: "world" });
  });

  it("上限を超えるボディはPayloadTooLargeErrorをthrowする / throws PayloadTooLargeError for bodies exceeding the limit", async () => {
    const oversized = Buffer.alloc(200, "x");
    await expect(readJsonBody(bodyStream(oversized), 100)).rejects.toThrow(PayloadTooLargeError);
  });
});

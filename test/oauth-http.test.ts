/**
 * OAuth Protected ResourceハンドシェイクのHTTPテスト
 * HTTP tests for the OAuth Protected Resource handshake
 * Test HTTP untuk handshake OAuth Protected Resource
 */
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssenHttpServer } from "../src/server.js";
import type { AssenEnv } from "../src/lib/env.js";

const env = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://example",
  MIGRATION_DATABASE_URL: "",
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_ACCESS_KEY: "key",
  STORAGE_SECRET_KEY: "secret",
  STORAGE_BUCKET: "bucket",
  PII_ENCRYPTION_KEY: "",
  PORT: 8080,
  AUTH_MODE: "oauth",
  AUTH_LOCAL_TOKEN: "",
  OAUTH_ISSUER: "https://assen.test",
  OAUTH_AUDIENCE: "assen",
  OAUTH_JWKS_URI: "https://assen.test/oauth/jwks.json",
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
  SLACK_KPI_CHANNEL_ID: "",
  GOOGLE_OAUTH_CLIENT_ID: "",
  GOOGLE_OAUTH_CLIENT_SECRET: "",
  TOKEN_EXCHANGE_ALLOWLIST_JSON: "[]",
  TOKEN_EXCHANGE_ISSUER: "https://assen.test",
  TOKEN_EXCHANGE_TOKEN_TTL_SECONDS: 3600,
  TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK: "",
} satisfies AssenEnv;

let server: ReturnType<typeof createAssenHttpServer>;
let baseUrl: string;

beforeAll(async () => {
  server = createAssenHttpServer(env);
  server.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("OAuth Protected Resource handshake", () => {
  it("/mcp未認証時にWWW-Authenticate resource_metadataを返す / returns WWW-Authenticate resource_metadata for unauthenticated /mcp", async () => {
    const response = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
  });

  it("Protected Resource Metadataを返す / returns Protected Resource Metadata", async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.resource).toBe(`${baseUrl}/mcp`);
    expect(body.authorization_servers).toEqual([baseUrl]);
  });
});

/**
 * AssenMcpClientのトークン交換とlistレスポンス整形を検証する
 * Verifies AssenMcpClient token exchange and list-response shaping
 * Memverifikasi pertukaran token AssenMcpClient dan pembentukan respons list
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssenMcpClient } from "../src/services/slack-bolt/assen-mcp-client.js";
import type { BoltEnv } from "../src/services/slack-bolt/bolt-env.js";

const env: BoltEnv = {
  NODE_ENV: "test",
  PORT: 8080,
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_SIGNING_SECRET: "signing-secret",
  SLACK_ALLOWED_TEAM_ID: "",
  ASSEN_MCP_URL: "https://assen.example.com/mcp",
  ASSEN_TOKEN_EXCHANGE_URL: "https://assen.example.com/oauth/token-exchange",
  GOOGLE_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
  ASSEN_JWT_CACHE_SKEW_SECONDS: 300,
};

describe("AssenMcpClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges a metadata Google ID token for an Assen JWT and caches it", async () => {
    const fetchImpl = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.includes("metadata.google.internal")) {
        return Promise.resolve(new Response("google-id-token", { status: 200 }));
      }
      if (url.includes("/oauth/token-exchange")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "assen-jwt", token_type: "Bearer", expires_in: 3600 }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    const client = new AssenMcpClient(env, fetchImpl);
    const token1 = await (
      client as unknown as { getAssenAccessToken: () => Promise<string> }
    ).getAssenAccessToken();
    const token2 = await (
      client as unknown as { getAssenAccessToken: () => Promise<string> }
    ).getAssenAccessToken();

    expect(token1).toBe("assen-jwt");
    expect(token2).toBe("assen-jwt");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

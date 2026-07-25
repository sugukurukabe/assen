/**
 * Claudeワンクリック接続向けOAuth discovery/PKCEの単体テスト
 * Unit tests for OAuth discovery/PKCE used by Claude one-click connection
 * Unit test untuk discovery/PKCE OAuth yang dipakai koneksi sekali klik Claude
 */
import { describe, expect, it } from "vitest";
import { buildAuthorizationServerMetadata, buildProtectedResourceMetadata } from "../src/lib/oauth-as.js";
import type { AssenEnv } from "../src/lib/env.js";

const env = {
  SERVER_CARD_REPOSITORY_URL: "",
} as AssenEnv;

describe("OAuth discovery metadata", () => {
  it("RFC 9728 Protected Resource Metadataで/mcpとASを広告する / advertises /mcp and AS via RFC 9728 Protected Resource Metadata", () => {
    const metadata = buildProtectedResourceMetadata("https://assen.example.com");

    expect(metadata).toMatchObject({
      resource: "https://assen.example.com/mcp",
      authorization_servers: ["https://assen.example.com"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["assen"],
    });
  });

  it("Authorization Server MetadataでDCR/PKCE/refreshを広告する / advertises DCR, PKCE, and refresh in AS metadata", () => {
    const metadata = buildAuthorizationServerMetadata("https://assen.example.com", env);

    expect(metadata).toMatchObject({
      issuer: "https://assen.example.com",
      authorization_endpoint: "https://assen.example.com/oauth/authorize",
      token_endpoint: "https://assen.example.com/oauth/token",
      registration_endpoint: "https://assen.example.com/oauth/register",
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
});

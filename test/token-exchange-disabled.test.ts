/**
 * トークン交換層が無効時（GOOGLE_OAUTH_CLIENT_ID未設定）の挙動を検証する。有効時のテストは
 * test/token-exchange.test.tsに分離している（env.loadEnvは初回呼び出しでキャッシュされるため、
 * 同一ファイル内でGOOGLE_OAUTH_CLIENT_IDの有無を切り替えることはできない）
 *
 * Verifies token-exchange behavior when disabled (GOOGLE_OAUTH_CLIENT_ID unset). Enabled-state tests live in
 * test/token-exchange.test.ts (env.loadEnv caches on first call, so GOOGLE_OAUTH_CLIENT_ID's presence cannot be
 * toggled within a single file)
 */
import { describe, expect, it } from "vitest";
import { exchangeGoogleIdTokenForAssenToken, getTokenExchangeJwks, isTokenExchangeEnabled } from "../src/lib/token-exchange.js";

describe("トークン交換層（無効時、既定の.env） / token-exchange layer (disabled, default .env)", () => {
  it("GOOGLE_OAUTH_CLIENT_ID未設定ならisTokenExchangeEnabledはfalseを返す / isTokenExchangeEnabled returns false when GOOGLE_OAUTH_CLIENT_ID is unset", () => {
    expect(isTokenExchangeEnabled()).toBe(false);
  });

  it("無効時はexchangeGoogleIdTokenForAssenTokenがネットワーク呼び出しをせず即座に拒否する / when disabled, exchangeGoogleIdTokenForAssenToken rejects immediately without any network call", async () => {
    await expect(exchangeGoogleIdTokenForAssenToken("irrelevant-token")).rejects.toThrow(/トークン交換は無効|disabled/);
  });

  it("無効時はgetTokenExchangeJwksが空のkeysを返す / when disabled, getTokenExchangeJwks returns an empty keys array", async () => {
    await expect(getTokenExchangeJwks()).resolves.toEqual({ keys: [] });
  });
});

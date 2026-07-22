/**
 * CORSポリシーの単体テスト：discoveryエンドポイントは常に全origin許可、/mcpは既定でCORS無効かつallowlistのみ許可することを確認する
 * Unit tests for the CORS policy: verifies discovery endpoints always allow all origins, while /mcp is disabled by
 * default and only allow-listed origins are permitted
 * Unit test untuk kebijakan CORS: memverifikasi endpoint discovery selalu mengizinkan semua origin, sedangkan /mcp
 * dinonaktifkan secara default dan hanya origin yang di-allowlist yang diizinkan
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { applyCorsHeaders, parseAllowedOrigins } from "../src/lib/cors.js";

function fakeReq(method: string, origin: string | undefined): IncomingMessage {
  return { method, headers: origin ? { origin } : {} } as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  } as unknown as ServerResponse & { headers: Record<string, string> };
}

describe("parseAllowedOrigins", () => {
  it("空文字は空集合になる（CORS無効） / an empty string becomes an empty set (CORS disabled)", () => {
    const result = parseAllowedOrigins("");
    expect(result).not.toBe("*");
    expect(result).toEqual(new Set());
  });

  it("*はワイルドカードとして扱う / \"*\" is treated as a wildcard", () => {
    expect(parseAllowedOrigins("*")).toBe("*");
  });

  it("カンマ区切りのoriginをtrimしてSetにする / trims comma-separated origins into a Set", () => {
    const result = parseAllowedOrigins("https://a.example.com, https://b.example.com ,");
    expect(result).toEqual(new Set(["https://a.example.com", "https://b.example.com"]));
  });
});

describe("applyCorsHeaders", () => {
  it("discoveryエンドポイントは常に全origin許可する / discovery endpoints always allow all origins", () => {
    const res = fakeRes();
    applyCorsHeaders(fakeReq("GET", "https://evil.example.com"), res, "/health", new Set());
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("/mcpはCORS_ALLOWED_ORIGINS未設定だとヘッダーを付与しない / /mcp gets no CORS headers when CORS_ALLOWED_ORIGINS is unset", () => {
    const res = fakeRes();
    applyCorsHeaders(fakeReq("POST", "https://untrusted.example.com"), res, "/mcp", new Set());
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("/mcpは許可originのみAccess-Control-Allow-Originを返す / /mcp only echoes Access-Control-Allow-Origin for allow-listed origins", () => {
    const allowed = new Set(["https://trusted.example.com"]);
    const allowedRes = fakeRes();
    applyCorsHeaders(fakeReq("POST", "https://trusted.example.com"), allowedRes, "/mcp", allowed);
    expect(allowedRes.headers["access-control-allow-origin"]).toBe("https://trusted.example.com");

    const rejectedRes = fakeRes();
    applyCorsHeaders(fakeReq("POST", "https://other.example.com"), rejectedRes, "/mcp", allowed);
    expect(rejectedRes.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("OPTIONSリクエストはpreflightとしてtrueを返す / OPTIONS requests are reported as a preflight via the return value", () => {
    const res = fakeRes();
    const isPreflight = applyCorsHeaders(fakeReq("OPTIONS", "https://trusted.example.com"), res, "/mcp", "*");
    expect(isPreflight).toBe(true);
  });

  it("originヘッダーが無いリクエストはpreflightでない限りヘッダーを付与しない / requests without an Origin header get no CORS headers unless preflight", () => {
    const res = fakeRes();
    const isPreflight = applyCorsHeaders(fakeReq("POST", undefined), res, "/mcp", "*");
    expect(isPreflight).toBe(false);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

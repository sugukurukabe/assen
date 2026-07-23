/**
 * CORSポリシー（§7準拠のMCPヘッダーを含む）。方針：
 * - 公開discoveryエンドポイント（/health・/ready・/.well-known/mcp.json）：認証も業務データも持たないため、常に全origin許可
 * - /mcp（実プロトコル・業務データ・Bearerトークンを扱う）：既定でCORS無効。CORS_ALLOWED_ORIGINSで明示的に許可したoriginのみ許可
 * CORS policy (includes MCP-specific headers per the spec). Policy:
 * - Public discovery endpoints (/health, /ready, /.well-known/mcp.json): always allow all origins (no auth, no business data)
 * - /mcp (the real protocol endpoint, carries business data and bearer tokens): CORS disabled by default; only origins
 *   explicitly allow-listed via CORS_ALLOWED_ORIGINS are permitted
 * Kebijakan CORS (termasuk header khusus MCP sesuai spesifikasi). Kebijakan:
 * - Endpoint discovery publik (/health, /ready, /.well-known/mcp.json): selalu mengizinkan semua origin (tanpa auth, tanpa data bisnis)
 * - /mcp (endpoint protokol sebenarnya, membawa data bisnis dan token bearer): CORS dinonaktifkan secara default; hanya origin
 *   yang diizinkan secara eksplisit via CORS_ALLOWED_ORIGINS yang diperbolehkan
 */
import type { IncomingMessage, ServerResponse } from "node:http";

// /oauth/jwks.json: OAuth/OIDC公開鍵は仕様上どこからでも取得可能であることが前提のため、常に全origin許可に含める
// /oauth/jwks.json: OAuth/OIDC public keys are expected by spec to be fetchable from anywhere, so it is always allow-all too
const DISCOVERY_PATHS: ReadonlySet<string> = new Set(["/health", "/ready", "/.well-known/mcp.json", "/oauth/jwks.json"]);

// StreamableHTTP transportが読み書きするMCP固有ヘッダー（@modelcontextprotocol/sdkのsrc実装に準拠）
// MCP-specific headers read/written by the Streamable HTTP transport (per @modelcontextprotocol/sdk's implementation)
// Header khusus MCP yang dibaca/ditulis oleh transport Streamable HTTP (sesuai implementasi @modelcontextprotocol/sdk)
const MCP_REQUEST_HEADERS = "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version";
const MCP_EXPOSED_HEADERS = "Mcp-Session-Id, Mcp-Protocol-Version";

export type AllowedOrigins = "*" | ReadonlySet<string>;

export function parseAllowedOrigins(value: string): AllowedOrigins {
  const trimmed = value.trim();
  if (trimmed === "*") {
    return "*";
  }
  return new Set(
    trimmed
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

/**
 * リクエストのpathに応じてCORSヘッダーを付与する。preflight(OPTIONS)ならtrueを返し、呼び出し側は204で即応答すること
 * Applies CORS headers based on the request path. Returns true for a preflight (OPTIONS) request; the caller should
 * respond immediately with 204 in that case
 * Menerapkan header CORS berdasarkan path permintaan. Mengembalikan true untuk permintaan preflight (OPTIONS); pemanggil
 * harus merespons langsung dengan 204 dalam kasus tersebut
 */
export function applyCorsHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  mcpAllowedOrigins: AllowedOrigins,
): boolean {
  const origin = req.headers.origin;
  const isPreflight = req.method === "OPTIONS";

  if (!origin) {
    return isPreflight;
  }

  if (DISCOVERY_PATHS.has(path)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    return isPreflight;
  }

  const isAllowed = mcpAllowedOrigins === "*" || mcpAllowedOrigins.has(origin);
  if (!isAllowed) {
    return isPreflight;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", MCP_REQUEST_HEADERS);
  res.setHeader("Access-Control-Expose-Headers", MCP_EXPOSED_HEADERS);
  res.setHeader("Access-Control-Max-Age", "600");
  return isPreflight;
}

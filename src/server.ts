/**
 * AssenのMCPサーバーエントリポイント（Streamable HTTP、リクエストごとにstatelessなMcpServerを生成）
 * Assen's MCP server entrypoint (Streamable HTTP, a stateless McpServer is created per request)
 * Entrypoint server MCP Assen (Streamable HTTP, McpServer stateless dibuat per permintaan)
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { acquireTenantScopedDb, getPool } from "./db/client.js";
import { readJsonBody } from "./lib/http-body.js";
import { assertProductionSafety, loadEnv, type AssenEnv } from "./lib/env.js";
import { logMessage } from "./lib/logger.js";
import { resolvePrincipal } from "./lib/auth.js";
import { ensureBucketExists } from "./lib/storage.js";
import { exchangeGoogleIdTokenForAssenToken, getTokenExchangeJwks } from "./lib/token-exchange.js";
import { PayloadTooLargeError, UserInputError } from "./lib/errors.js";
import { applyCorsHeaders, parseAllowedOrigins } from "./lib/cors.js";
import { createAssenMcpServer } from "./protocol/mcp-factory.js";
import { buildServerCard } from "./protocol/server-card.js";
import type { ServiceContext } from "./protocol/service-context.js";

function extractBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = randomUUID();
  const env = loadEnv();

  let principal;
  try {
    principal = await resolvePrincipal(extractBearerToken(req));
  } catch (error) {
    logMessage("warning", "認証に失敗しました / authentication failed", {
      error: error instanceof Error ? error.message : String(error),
      requestId,
    });
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  // DB pool checkoutより前に本文サイズを検証し、超過リクエストがコネクションを消費しないようにする
  // Validates body size before checking out a DB connection, so oversized requests never consume a pool slot
  // Memvalidasi ukuran body sebelum checkout koneksi DB, agar permintaan yang terlalu besar tidak memakai slot pool
  let parsedBody: unknown;
  try {
    parsedBody = req.method === "POST" ? await readJsonBody(req, env.MAX_REQUEST_BODY_BYTES) : undefined;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      logMessage("warning", "リクエストボディが上限を超えました / request body exceeded the limit", { requestId });
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "payload_too_large" }));
      return;
    }
    throw error;
  }

  // リクエスト専用のpool checkoutでapp.tenant_idを固定し、RLSのテナント分離を全クエリに効かせる（§4）
  // Pins app.tenant_id on a request-dedicated pool checkout so RLS tenant isolation applies to every query (§4)
  // Mengunci app.tenant_id pada checkout pool khusus permintaan agar isolasi tenant RLS berlaku pada setiap query (§4)
  const tenantScopedDb = await acquireTenantScopedDb(principal.tenantId);
  let released = false;
  const release = (): void => {
    if (!released) {
      released = true;
      tenantScopedDb.release();
    }
  };

  try {
    const context: ServiceContext = { principal, requestId, db: tenantScopedDb.db };
    const server = createAssenMcpServer(context);
    // ステートレス: セッションIDを発行せず、リクエストごとに使い捨てのtransportを接続する（§2.4）
    // Stateless: no session id is issued; a disposable transport is connected per request (§2.4)
    // Stateless: tidak ada session id yang diterbitkan; transport sekali pakai dihubungkan per permintaan (§2.4)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      void transport.close();
      void server.close();
      release();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    // res.on("close")が登録される前に例外が発生した場合でも、pool clientが確実に解放されるようにする
    // Guarantees the pool client is released even if an exception occurs before res.on("close") is registered
    // Memastikan pool client dilepas meskipun terjadi exception sebelum res.on("close") terdaftar
    release();
    throw error;
  }
}

/**
 * document.approval_requestedのSlack通知等と同じく自社MVPゲート（docs/registry-readiness-checklist.md G節）の一部。
 * Google IDトークンをAssen専用クレーム付きJWTへ交換する。トークン交換自体がログイン処理のためBearer認証は要求しない
 * Part of the internal-MVP gate (checklist section G). Exchanges a Google ID token for a JWT carrying Assen's
 * own claims. Does not require Bearer auth itself, since this endpoint IS the login flow
 */
async function handleTokenExchangeRequest(req: IncomingMessage, res: ServerResponse, env: AssenEnv): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req, env.MAX_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "payload_too_large" }));
      return;
    }
    throw error;
  }

  const googleIdToken = (body as { google_id_token?: unknown } | undefined)?.google_id_token;
  if (typeof googleIdToken !== "string" || googleIdToken.length === 0) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "google_id_token is required" }));
    return;
  }

  try {
    const result = await exchangeGoogleIdTokenForAssenToken(googleIdToken);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ access_token: result.accessToken, token_type: result.tokenType, expires_in: result.expiresIn }));
  } catch (error) {
    if (error instanceof UserInputError) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message, remediation: error.remediation }));
      return;
    }
    logMessage("error", "トークン交換に失敗しました / token exchange failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error" }));
  }
}

/**
 * 実際にDBへ接続できるかを確認するreadiness probe（/healthは静的チェックのみ）
 * Readiness probe that verifies actual DB connectivity (/health is a static check only)
 * Readiness probe yang memverifikasi konektivitas DB aktual (/health hanya pengecekan statis)
 */
async function handleReadyRequest(res: ServerResponse): Promise<void> {
  try {
    await getPool().query("select 1");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ready" }));
  } catch (error) {
    logMessage("error", "readiness確認に失敗しました / readiness check failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "not_ready" }));
  }
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * HTTPサーバーを構築するが`.listen()`は呼ばない（テストがエフェメラルポートで起動・破棄できるようにするため）。
 * `main()`はこれを呼んでから`.listen(env.PORT)`する
 *
 * Builds the HTTP server without calling `.listen()` (so tests can spin it up on an ephemeral port and tear it
 * down). `main()` calls this then `.listen(env.PORT)`
 *
 * Membangun HTTP server tanpa memanggil `.listen()` (agar test dapat menjalankannya di port efemeral dan
 * membongkarnya). `main()` memanggil ini lalu `.listen(env.PORT)`
 */
export function createAssenHttpServer(env: AssenEnv): Server {
  const mcpAllowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

  return createServer((req, res) => {
    const isPreflight = applyCorsHeaders(req, res, req.url ?? "", mcpAllowedOrigins);
    if (isPreflight) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: "assen" }));
      return;
    }

    if (req.url === "/ready") {
      handleReadyRequest(res).catch((error: unknown) => {
        logMessage("critical", "readinessハンドラで予期しないエラー / unexpected error in readiness handler", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    // Server Card：レジストリ/クローラーがハンドシェイク不要で発見できる静的マニフェスト（SEP-2127 Draft）
    // Server Card: static manifest discoverable by registries/crawlers without a handshake (SEP-2127 Draft)
    // Server Card: manifest statis yang dapat ditemukan registry/crawler tanpa handshake (SEP-2127 Draft)
    if (req.url === "/.well-known/mcp.json") {
      const forwardedProto = req.headers["x-forwarded-proto"];
      const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ?? "http";
      const host = req.headers.host ?? `localhost:${env.PORT}`;
      const card = buildServerCard(`${protocol}://${host}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(card, null, 2));
      return;
    }

    if (req.url === "/oauth/jwks.json") {
      getTokenExchangeJwks()
        .then((jwks) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(jwks));
        })
        .catch((error: unknown) => {
          logMessage("critical", "JWKS配信で予期しないエラー / unexpected error while serving JWKS", {
            error: error instanceof Error ? error.message : String(error),
          });
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "internal_error" }));
          }
        });
      return;
    }

    if (req.url === "/oauth/token-exchange" && req.method === "POST") {
      handleTokenExchangeRequest(req, res, env).catch((error: unknown) => {
        logMessage("critical", "トークン交換ハンドラで予期しないエラー / unexpected error in the token-exchange handler", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error" }));
        }
      });
      return;
    }

    if (req.url === "/mcp") {
      handleMcpRequest(req, res).catch((error: unknown) => {
        logMessage("critical", "MCPリクエスト処理に失敗しました / MCP request handling failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error" }));
        }
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}

function main(): void {
  const env = loadEnv();
  assertProductionSafety(env);

  ensureBucketExists().catch((error: unknown) => {
    logMessage("warning", "起動時のバケット確認に失敗しました / bucket check at startup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const httpServer = createAssenHttpServer(env);

  httpServer.listen(env.PORT, () => {
    logMessage("info", "Assen MCPサーバーを起動しました / Assen MCP server started", { port: env.PORT });
  });

  // Cloud Run等がSIGTERMを送った際、新規接続を止めてin-flightリクエストを完了させ、DBプールを閉じてから終了する
  // On SIGTERM (e.g. from Cloud Run), stop accepting new connections, let in-flight requests finish, close the DB pool, then exit
  // Saat SIGTERM (misalnya dari Cloud Run), berhenti menerima koneksi baru, biarkan permintaan in-flight selesai, tutup pool DB, lalu keluar
  function shutdown(signal: string): void {
    logMessage("info", `${signal}を受信。グレースフルシャットダウンを開始します / received ${signal}, starting graceful shutdown`);

    const forceExitTimer = setTimeout(() => {
      logMessage("critical", "シャットダウンがタイムアウトしたため強制終了します / shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    httpServer.close(() => {
      getPool()
        .end()
        .then(() => {
          clearTimeout(forceExitTimer);
          logMessage("info", "グレースフルシャットダウン完了 / graceful shutdown complete");
          process.exit(0);
        })
        .catch((error: unknown) => {
          clearTimeout(forceExitTimer);
          logMessage("error", "DBプールのクローズに失敗しました / failed to close the DB pool", {
            error: error instanceof Error ? error.message : String(error),
          });
          process.exit(1);
        });
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();

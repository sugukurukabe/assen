/**
 * Assen Slack Boltサービスのエントリポイント。
 * Workflow BuilderのカスタムステップからAssen MCPのlistツールを呼び、動的選択肢を返す。
 * Entry point for the Assen Slack Bolt service.
 * Calls Assen MCP list tools from Workflow Builder custom steps and returns dynamic options.
 * Titik masuk layanan Assen Slack Bolt.
 * Memanggil tool list Assen MCP dari custom step Workflow Builder dan mengembalikan opsi dinamis.
 */
import { pathToFileURL } from "node:url";
import { App } from "@slack/bolt";
import { logMessage } from "../../lib/logger.js";
import { AssenMcpClient } from "./assen-mcp-client.js";
import { loadBoltEnv } from "./bolt-env.js";
import { registerMasterPicker } from "./master-picker.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function extractTeamId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.team_id === "string") {
    return record.team_id;
  }
  if (typeof record.team === "object" && record.team !== null) {
    const team = record.team as Record<string, unknown>;
    if (typeof team.id === "string") {
      return team.id;
    }
  }
  if (typeof record.user === "object" && record.user !== null) {
    const user = record.user as Record<string, unknown>;
    if (typeof user.team_id === "string") {
      return user.team_id;
    }
  }
  return undefined;
}

export function createBoltApp(): { app: App; mcpClient: AssenMcpClient } {
  const env = loadBoltEnv();
  const mcpClient = new AssenMcpClient(env);

  const app = new App({
    token: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    endpoints: "/slack/events",
    processBeforeResponse: true,
    attachFunctionToken: true,
    // プレースホルダtokenや一時的な失効でも起動を落とさない（リクエスト署名検証は別途有効）
    // Do not crash on startup for placeholder/expired tokens (request signature verification stays on)
    // Jangan crash saat startup karena token placeholder/kedaluwarsa (verifikasi tanda tangan request tetap aktif)
    tokenVerificationEnabled: !env.SLACK_BOT_TOKEN.includes("placeholder"),
    customRoutes: [
      {
        path: "/health",
        method: ["GET"],
        handler: (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ok", service: "assen-slack-bolt" }));
        },
      },
      {
        path: "/ready",
        method: ["GET"],
        handler: (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "ready", service: "assen-slack-bolt" }));
        },
      },
    ],
  });

  if (env.SLACK_ALLOWED_TEAM_ID) {
    const allowedTeamId = env.SLACK_ALLOWED_TEAM_ID;
    app.use(async ({ body, next }) => {
      const teamId = extractTeamId(body);
      if (teamId && teamId !== allowedTeamId) {
        logMessage("warning", "自社以外のSlackチームからのリクエストを拒否しました / rejected request from a non-allowed Slack team", {
          teamId,
        });
        throw new Error("team_not_allowed");
      }
      await next();
    });
  }

  // block_actionsの生ペイロードを診断（trigger_id欠落の切り分け）
  // Diagnose raw block_actions payloads (to isolate missing trigger_id)
  // Diagnosis payload mentah block_actions (untuk isolasi trigger_id yang hilang)
  app.use(async ({ body, next }) => {
    if (typeof body === "object" && body !== null && (body as { type?: unknown }).type === "block_actions") {
      const record = body as Record<string, unknown>;
      const actions = Array.isArray(record.actions) ? record.actions : [];
      logMessage("info", "block_actionsを受信しました / received block_actions", {
        keys: Object.keys(record).slice(0, 40),
        triggerIdType: typeof record.trigger_id,
        hasTriggerId: typeof record.trigger_id === "string" && record.trigger_id.length > 0,
        actionIds: actions
          .map((item) =>
            typeof item === "object" && item !== null && typeof (item as { action_id?: unknown }).action_id === "string"
              ? (item as { action_id: string }).action_id
              : "?",
          )
          .slice(0, 5),
      });
    }
    await next();
  });

  // function_executedの到達とcallback_id不一致を診断できるようにする
  // Log function_executed arrivals so callback_id mismatches are diagnosable
  // Catat kedatangan function_executed agar ketidakcocokan callback_id bisa didiagnosis
  app.event("function_executed", async ({ event }) => {
    const callbackId =
      typeof event === "object" &&
      event !== null &&
      "function" in event &&
      typeof (event as { function?: { callback_id?: unknown } }).function?.callback_id === "string"
        ? (event as { function: { callback_id: string } }).function.callback_id
        : "unknown";
    logMessage("info", "function_executedを受信しました / received function_executed", {
      callbackId,
      functionExecutionId:
        typeof (event as { function_execution_id?: unknown }).function_execution_id === "string"
          ? (event as { function_execution_id: string }).function_execution_id
          : undefined,
      inputKeys:
        typeof (event as { inputs?: unknown }).inputs === "object" &&
        (event as { inputs?: object }).inputs !== null
          ? Object.keys((event as { inputs: Record<string, unknown> }).inputs)
          : [],
    });
  });

  registerMasterPicker(app, mcpClient);
  return { app, mcpClient };
}

async function main(): Promise<void> {
  const env = loadBoltEnv();
  const { app, mcpClient } = createBoltApp();
  await app.start(env.PORT);
  logMessage("info", "assen-slack-boltが起動しました / assen-slack-bolt started", {
    port: env.PORT,
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logMessage("info", `assen-slack-boltが${signal}を受信しました / assen-slack-bolt received ${signal}`);
    const forceExit = setTimeout(() => {
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    void (async () => {
      try {
        await app.stop();
        await mcpClient.close();
        process.exit(0);
      } catch (error) {
        logMessage("error", "assen-slack-boltのシャットダウンに失敗しました / assen-slack-bolt shutdown failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    })();
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(
      "assen-slack-boltの起動に失敗しました / failed to start assen-slack-bolt:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}

/**
 * Assen MCPへservice account経由でtools/callするクライアント。
 * Cloud RunメタデータからGoogle IDトークンを取得し、/oauth/token-exchangeでAssen JWTへ交換する。
 * Client that calls Assen MCP tools/call via a service account.
 * Fetches a Google ID token from Cloud Run metadata and exchanges it for an Assen JWT at /oauth/token-exchange.
 * Klien yang memanggil tools/call Assen MCP melalui service account.
 * Mengambil Google ID token dari metadata Cloud Run dan menukarnya menjadi Assen JWT di /oauth/token-exchange.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logMessage } from "../../lib/logger.js";
import type { BoltEnv } from "./bolt-env.js";

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

export interface ListOptionItem {
  value: string;
  label: string;
}

export interface ListOptionsResult {
  items: ListOptionItem[];
  total: number;
  truncated: boolean;
}

export type ListToolName = "staff_list" | "partner_list" | "job_seeker_list";

interface CachedAssenToken {
  accessToken: string;
  expiresAtMs: number;
}

export class AssenMcpClient {
  private cachedToken: CachedAssenToken | undefined;
  private client: Client | undefined;
  private transport: StreamableHTTPClientTransport | undefined;
  private connectPromise: Promise<void> | undefined;

  constructor(
    private readonly env: BoltEnv,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * list系ツールを呼び、items/total/truncatedを返す
   * Calls a list tool and returns items/total/truncated
   * Memanggil tool list dan mengembalikan items/total/truncated
   */
  async callListTool(
    toolName: ListToolName,
    args: { query?: string; status?: string; limit?: number },
  ): Promise<ListOptionsResult> {
    await this.ensureConnected();
    if (!this.client) {
      throw new Error("Assen MCP client is not connected");
    }

    const result = await this.client.callTool({
      name: toolName,
      arguments: {
        ...(args.query !== undefined ? { query: args.query } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      },
    });

    if (result.isError) {
      const text = extractTextContent(result.content);
      throw new Error(`${toolName} returned isError: ${text}`);
    }

    const text = extractTextContent(result.content);
    const parsed = JSON.parse(text) as unknown;
    return assertListOptionsResult(parsed, toolName);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => undefined);
    }
    if (this.transport) {
      await this.transport.close().catch(() => undefined);
    }
    this.client = undefined;
    this.transport = undefined;
    this.connectPromise = undefined;
  }

  private async ensureConnected(): Promise<void> {
    if (this.client) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.connect().catch((error: unknown) => {
        this.connectPromise = undefined;
        throw error;
      });
    }
    await this.connectPromise;
  }

  private async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(new URL(this.env.ASSEN_MCP_URL), {
      fetch: async (url, init) => {
        const accessToken = await this.getAssenAccessToken();
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${accessToken}`);
        return this.fetchImpl(url, { ...init, headers });
      },
    });
    const client = new Client({ name: "assen-slack-bolt", version: "0.1.0" });
    await client.connect(transport);
    this.transport = transport;
    this.client = client;
    logMessage("info", "Assen MCPクライアントを接続しました / connected Assen MCP client");
  }

  private async getAssenAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs > now) {
      return this.cachedToken.accessToken;
    }

    const googleIdToken = await this.fetchGoogleIdToken();
    const exchangeRes = await this.fetchImpl(this.env.ASSEN_TOKEN_EXCHANGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ google_id_token: googleIdToken }),
    });
    const exchangeJson = (await exchangeRes.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!exchangeRes.ok || !exchangeJson.access_token) {
      throw new Error(
        `Assen token exchange failed: ${exchangeJson.error ?? exchangeRes.status}`,
      );
    }

    const expiresInSeconds = exchangeJson.expires_in ?? 3600;
    const skewMs = this.env.ASSEN_JWT_CACHE_SKEW_SECONDS * 1000;
    this.cachedToken = {
      accessToken: exchangeJson.access_token,
      expiresAtMs: now + Math.max(30_000, expiresInSeconds * 1000 - skewMs),
    };
    return this.cachedToken.accessToken;
  }

  private async fetchGoogleIdToken(): Promise<string> {
    const url = new URL(METADATA_IDENTITY_URL);
    url.searchParams.set("audience", this.env.GOOGLE_OAUTH_CLIENT_ID);
    url.searchParams.set("format", "full");
    url.searchParams.set("include_email", "true");

    const response = await this.fetchImpl(url.toString(), {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to fetch Google ID token from metadata: ${response.status} ${body}`);
    }
    return response.text();
  }
}

function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === "string" ? content : "";
  }
  const texts = content
    .filter((block): block is { type: "text"; text: string } => {
      return (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block as { type: unknown }).type === "text" &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
      );
    })
    .map((block) => block.text);
  return texts.join("\n");
}

function assertListOptionsResult(value: unknown, toolName: string): ListOptionsResult {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${toolName} returned a non-object payload`);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items) || typeof record.total !== "number" || typeof record.truncated !== "boolean") {
    throw new Error(`${toolName} returned an unexpected shape`);
  }
  const items: ListOptionItem[] = record.items.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`${toolName} items[${index}] is not an object`);
    }
    const row = item as Record<string, unknown>;
    if (typeof row.value !== "string" || typeof row.label !== "string") {
      throw new Error(`${toolName} items[${index}] lacks value/label strings`);
    }
    return { value: row.value, label: row.label };
  });
  return { items, total: record.total, truncated: record.truncated };
}

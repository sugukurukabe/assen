/**
 * MCP capability宣言（§2.4）。実装済みの標準プリミティブだけを宣言し、未実装capabilityを先行宣言しない
 * MCP capability declaration (§2.4). Declares only implemented standard primitives and avoids pre-declaring unimplemented capabilities
 * Deklarasi capability MCP (§2.4). Hanya mendeklarasikan primitive standar yang sudah diimplementasikan dan tidak mendeklarasikan capability yang belum ada
 */
import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";

export const assenServerCapabilities: ServerOptions = {
  capabilities: {
    tools: { listChanged: false },
    resources: { listChanged: false, subscribe: false },
    prompts: { listChanged: false },
  },
};

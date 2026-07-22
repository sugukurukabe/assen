/**
 * MCP capability宣言（§2.4・mcp-reference-build skill Phase3）。宣言した機能は全て実活性化する（嘘宣言をしない）
 * MCP capability declaration (§2.4, mcp-reference-build skill Phase 3). Every declared capability is genuinely activated (no false declarations)
 * Deklarasi capability MCP (§2.4, skill mcp-reference-build Fase 3). Setiap capability yang dideklarasikan benar-benar diaktifkan (tidak ada deklarasi palsu)
 */
import type { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";

export const assenServerCapabilities: ServerOptions = {
  capabilities: {
    tools: { listChanged: false },
    resources: { listChanged: false, subscribe: false },
    prompts: { listChanged: false },
    completions: {},
    logging: {},
  },
};

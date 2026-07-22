/**
 * McpServerインスタンスのファクトリ。ツール・リソース・プロンプトを登録し、capabilityを宣言する
 * Factory for McpServer instances. Registers tools/resources/prompts and declares capabilities
 * Factory untuk instance McpServer. Mendaftarkan tools/resources/prompts dan mendeklarasikan capability
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assenServerCapabilities } from "./capabilities.js";
import type { ServiceContext } from "./service-context.js";
import { registerAllTools } from "../tools/index.js";
import { registerAllResources } from "../resources/index.js";
import { registerAllPrompts } from "../prompts/index.js";

export const ASSEN_SERVER_INFO = {
  name: "assen",
  version: "0.1.0",
} as const;

/**
 * リクエストごとにMcpServerを1つ生成する（ステートレス方針：§2.4）
 * Creates one McpServer per request (stateless policy: §2.4)
 * Membuat satu McpServer per permintaan (kebijakan stateless: §2.4)
 */
export function createAssenMcpServer(context: ServiceContext): McpServer {
  const server = new McpServer(ASSEN_SERVER_INFO, assenServerCapabilities);
  registerAllTools(server, context);
  registerAllResources(server, context);
  registerAllPrompts(server, context);
  return server;
}

/**
 * 実際に登録されているMCPツール一覧を取得する。InMemoryTransportで実物のMcpServerへ接続し、
 * 本番と同じtools/listレスポンスを使う（ツール名・descriptionをハードコードで二重管理しない）
 *
 * Fetches the actually-registered MCP tool catalog. Connects to a real McpServer over an InMemoryTransport
 * and uses the same tools/list response production uses (avoids a hand-maintained, drifting duplicate list)
 *
 * Mengambil katalog tool MCP yang benar-benar terdaftar. Terhubung ke McpServer sungguhan via InMemoryTransport
 * dan menggunakan respons tools/list yang sama dengan produksi (menghindari daftar duplikat yang dikelola manual)
 */
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAssenMcpServer } from "../../protocol/mcp-factory.js";
import type { ServiceContext } from "../../protocol/service-context.js";
import { db } from "../../db/client.js";
import type { ToolDescriptorForSelection } from "./types.js";

/**
 * tools/listだけを取得する目的のダミーコンテキスト。ツールのハンドラは実行しない（呼び出さない）ため、
 * principalの内容は本物のツール実行では使えないが、カタログ取得には影響しない
 * A dummy context used solely to fetch tools/list. Tool handlers are never invoked here, so the principal's
 * contents would not work for real tool execution, but that has no bearing on catalog retrieval
 * Konteks dummy yang hanya digunakan untuk mengambil tools/list. Handler tool tidak pernah dipanggil di sini,
 * jadi isi principal tidak akan berfungsi untuk eksekusi tool sungguhan, tapi tidak berpengaruh pada pengambilan katalog
 */
function buildCatalogOnlyContext(): ServiceContext {
  return {
    principal: {
      principalId: "golden-prompt-catalog",
      role: "admin",
      authMethod: "local_fixed_token",
      tenantId: randomUUID(),
    },
    requestId: randomUUID(),
    db,
  };
}

export async function listRegisteredTools(): Promise<ToolDescriptorForSelection[]> {
  const server = createAssenMcpServer(buildCatalogOnlyContext());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "assen-golden-prompt-harness", version: "0.1.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const response = await client.listTools();
    return response.tools.map((tool) => ({ name: tool.name, description: tool.description }));
  } finally {
    await client.close();
    await server.close();
  }
}

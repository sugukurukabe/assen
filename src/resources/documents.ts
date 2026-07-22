/**
 * assen://documents/{logicalDocumentId}/{version} リソース。版管理された生成文書を参照専用で公開する
 * assen://documents/{logicalDocumentId}/{version} resource. Exposes versioned generated documents read-only
 * Resource assen://documents/{logicalDocumentId}/{version}. Mengekspos dokumen yang dihasilkan dan diberi versi secara read-only
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "../protocol/service-context.js";
import { documents } from "../db/schema/documents.js";
import { buildPage } from "../lib/pagination.js";

const PAGE_SIZE = 20;

export function registerDocumentsResource(server: McpServer, context: ServiceContext): void {
  const template = new ResourceTemplate("assen://documents/{logicalDocumentId}/{version}", {
    list: async () => {
      const rows = await context.db.select().from(documents).limit(PAGE_SIZE + 1);
      const page = buildPage(rows, PAGE_SIZE, 0);
      return {
        resources: page.items.map((row) => ({
          uri: `assen://documents/${row.logicalDocumentId}/${row.version}`,
          name: `${row.docType}@v${row.version}`,
          mimeType: "application/json",
        })),
        nextCursor: page.nextCursor,
      };
    },
  });

  server.registerResource(
    "documents",
    template,
    {
      title: "生成文書 / Generated documents / Dokumen yang dihasilkan",
      description:
        "版管理された生成文書のメタデータ（5系統状態機械・ハッシュ・テンプレート版を含む） / Versioned generated-document metadata (5 status tracks, hashes, template version) / Metadata dokumen yang dihasilkan dan diberi versi (5 jalur status, hash, versi template)",
    },
    async (uri, variables) => {
      const logicalDocumentId = String(variables.logicalDocumentId);
      const version = Number(variables.version);
      const [row] = await context.db
        .select()
        .from(documents)
        .where(and(eq(documents.logicalDocumentId, logicalDocumentId), eq(documents.version, version)));

      if (!row) {
        return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify({ error: "not_found" }) }] };
      }

      return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(row, null, 2) }] };
    },
  );
}

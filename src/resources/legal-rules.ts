/**
 * assen://legal-rules/{ruleKey}/{version} リソース。版管理された法令ルールを参照専用で公開する
 * assen://legal-rules/{ruleKey}/{version} resource. Exposes versioned legal rules read-only
 * Resource assen://legal-rules/{ruleKey}/{version}. Mengekspos rule hukum yang diberi versi secara read-only
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "../protocol/service-context.js";
import { legalRules } from "../db/schema/legal.js";
import { buildPage } from "../lib/pagination.js";

const PAGE_SIZE = 20;

export function registerLegalRulesResource(server: McpServer, context: ServiceContext): void {
  const template = new ResourceTemplate("assen://legal-rules/{ruleKey}/{version}", {
    list: async () => {
      const offset = 0;
      const rows = await context.db.select().from(legalRules).limit(PAGE_SIZE + 1).offset(offset);
      const page = buildPage(rows, PAGE_SIZE, offset);
      return {
        resources: page.items.map((row) => ({
          uri: `assen://legal-rules/${row.ruleKey}/${row.version}`,
          name: `${row.ruleKey}@${row.version}`,
          mimeType: "application/json",
        })),
        nextCursor: page.nextCursor,
      };
    },
  });

  server.registerResource(
    "legal-rules",
    template,
    {
      title: "法令ルール / Legal rules / Rule hukum",
      description: "版管理された決定論的法令ルールの定義 / Versioned deterministic legal rule definitions / Definisi rule hukum deterministik yang diberi versi",
    },
    async (uri, variables) => {
      const ruleKey = String(variables.ruleKey);
      const version = String(variables.version);
      const [row] = await context.db
        .select()
        .from(legalRules)
        .where(and(eq(legalRules.ruleKey, ruleKey), eq(legalRules.version, version)));

      if (!row) {
        return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify({ error: "not_found" }) }] };
      }

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(row, null, 2),
          },
        ],
      };
    },
  );
}

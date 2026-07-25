/**
 * assen://legal-rules/{ruleKey}/{version} リソース。DB行があればそれを、なければlegal/rules/のJSONを返す
 * assen://legal-rules/{ruleKey}/{version} resource. Returns a DB row when present; otherwise JSON from legal/rules/
 * Resource assen://legal-rules/{ruleKey}/{version}. Mengembalikan baris DB jika ada; jika tidak, JSON dari legal/rules/
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "../protocol/service-context.js";
import { legalRules } from "../db/schema/legal.js";
import { buildPage } from "../lib/pagination.js";
import { findProjectRoot } from "../lib/project-root.js";

const PAGE_SIZE = 20;

function listFileBasedRules(): Array<{ ruleKey: string; version: string }> {
  const dir = join(findProjectRoot(import.meta.url), "legal", "rules");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      // esa-gates.v1.json → ruleKey=esa-gates, version=v1
      const base = name.replace(/\.json$/, "");
      const match = base.match(/^(.*)\.(v\d+)$/);
      if (!match || !match[1] || !match[2]) {
        return { ruleKey: base, version: "v1" };
      }
      return { ruleKey: match[1], version: match[2] };
    });
}

function loadFileBasedRule(ruleKey: string, version: string): object | undefined {
  const path = join(findProjectRoot(import.meta.url), "legal", "rules", `${ruleKey}.${version}.json`);
  if (!existsSync(path)) {
    return undefined;
  }
  return JSON.parse(readFileSync(path, "utf8")) as object;
}

export function registerLegalRulesResource(server: McpServer, context: ServiceContext): void {
  const template = new ResourceTemplate("assen://legal-rules/{ruleKey}/{version}", {
    list: async () => {
      const offset = 0;
      const rows = await context.db.select().from(legalRules).limit(PAGE_SIZE + 1).offset(offset);
      const page = buildPage(rows, PAGE_SIZE, offset);
      const fromDb = page.items.map((row) => ({
        uri: `assen://legal-rules/${row.ruleKey}/${row.version}`,
        name: `${row.ruleKey}@${row.version}`,
        mimeType: "application/json",
      }));
      const fromFiles = listFileBasedRules().map((rule) => ({
        uri: `assen://legal-rules/${rule.ruleKey}/${rule.version}`,
        name: `${rule.ruleKey}@${rule.version}`,
        mimeType: "application/json",
      }));
      const seen = new Set(fromDb.map((item) => item.uri));
      const merged = [...fromDb, ...fromFiles.filter((item) => !seen.has(item.uri))];
      return {
        resources: merged,
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

      if (row) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(row, null, 2),
            },
          ],
        };
      }

      const fileRule = loadFileBasedRule(ruleKey, version);
      if (fileRule) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(fileRule, null, 2),
            },
          ],
        };
      }

      return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify({ error: "not_found" }) }] };
    },
  );
}

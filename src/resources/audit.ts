/**
 * assen://audit/{subjectType}/{subjectId} リソース。改ざん困難なハッシュチェーン監査ログを参照専用で公開する
 * assen://audit/{subjectType}/{subjectId} resource. Exposes the tamper-resistant hash-chained audit log read-only
 * Resource assen://audit/{subjectType}/{subjectId}. Mengekspos log audit berantai hash yang tahan perubahan secara read-only
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asc, eq } from "drizzle-orm";
import type { ServiceContext } from "../protocol/service-context.js";
import { auditEvents } from "../db/schema/audit.js";

export function registerAuditResource(server: McpServer, context: ServiceContext): void {
  const template = new ResourceTemplate("assen://audit/{subjectType}/{subjectId}", {
    list: () => ({ resources: [] }),
  });

  server.registerResource(
    "audit",
    template,
    {
      title: "監査ログ / Audit log / Log audit",
      description:
        "指定subjectのaudit_eventsをchain_sequence順に返す（改ざん検出用のevent_hash/previous_event_hashを含む） / Returns audit_events for a subject in chain_sequence order (includes event_hash/previous_event_hash for tamper detection) / Mengembalikan audit_events untuk subject dalam urutan chain_sequence (termasuk event_hash/previous_event_hash untuk deteksi perubahan)",
    },
    async (uri, variables) => {
      const subjectType = String(variables.subjectType);
      const subjectId = String(variables.subjectId);
      const rows = await context.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.aggregateId, subjectId))
        .orderBy(asc(auditEvents.chainSequence));

      const filtered = rows.filter((row) => row.aggregateType === subjectType);
      // chain_sequenceはbigserial(bigint)なため、JSON.stringifyできるよう文字列化する
      // chain_sequence is a bigserial(bigint), so stringify it for JSON.stringify compatibility
      // chain_sequence adalah bigserial(bigint), jadi ubah ke string agar kompatibel dengan JSON.stringify
      const serializable = filtered.map((row) => ({ ...row, chainSequence: row.chainSequence.toString() }));

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(serializable, null, 2),
          },
        ],
      };
    },
  );
}

/**
 * assen://findings/{findingId} リソース。findingIdは"{subjectType}:{subjectId}:{ruleKey}"の合成キー。
 * findingsはDBに永続化しないため、compliance.evaluate相当の判定を再実行して該当ruleKeyのfindingを返す
 * assen://findings/{findingId} resource. findingId is the composite key "{subjectType}:{subjectId}:{ruleKey}".
 * Findings are not persisted, so this re-runs the compliance.evaluate-equivalent judgement and returns the matching ruleKey's finding
 * Resource assen://findings/{findingId}. findingId adalah composite key "{subjectType}:{subjectId}:{ruleKey}".
 * Findings tidak dipersist, jadi ini menjalankan ulang penilaian setara compliance.evaluate dan mengembalikan finding ruleKey yang cocok
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import type { ServiceContext } from "../protocol/service-context.js";
import { jobOrders } from "../db/schema/ledgers.js";
import { evaluateSubjectCompliance } from "../services/rules/evaluate-subject.js";

const SUBJECT_TYPE_MAPPING_FILE: Record<string, string> = {
  job_order: "job-order-ledger.json",
};

export function registerFindingsResource(server: McpServer, context: ServiceContext): void {
  const template = new ResourceTemplate("assen://findings/{findingId}", {
    list: () => ({ resources: [] }),
  });

  server.registerResource(
    "findings",
    template,
    {
      title: "法令遵守findings / Compliance findings / Findings kepatuhan",
      description:
        "決定論的ルール判定のfinding 1件。findingIdは subjectType:subjectId:ruleKey の合成キー。 / A single deterministic-rule finding. findingId is the composite key subjectType:subjectId:ruleKey. / Satu finding rule deterministik. findingId adalah composite key subjectType:subjectId:ruleKey.",
    },
    async (uri, variables) => {
      const findingId = String(variables.findingId);
      const [subjectType, subjectId, ruleKey] = findingId.split(":");

      if (!subjectType || !subjectId || !ruleKey || !SUBJECT_TYPE_MAPPING_FILE[subjectType]) {
        return {
          contents: [
            { uri: uri.toString(), mimeType: "application/json", text: JSON.stringify({ error: "invalid_or_unsupported_finding_id" }) },
          ],
        };
      }

      const [row] = subjectType === "job_order" ? await context.db.select().from(jobOrders).where(eq(jobOrders.id, subjectId)) : [];
      if (!row) {
        return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify({ error: "subject_not_found" }) }] };
      }

      const findings = await evaluateSubjectCompliance(context.db, {
        tenantId: context.principal.tenantId,
        subjectType,
        subjectId,
        mappingFileName: SUBJECT_TYPE_MAPPING_FILE[subjectType],
        row: row,
      });

      const finding = findings.find((candidate) => candidate.ruleKey === ruleKey);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(finding ?? { error: "finding_not_found" }, null, 2),
          },
        ],
      };
    },
  );
}

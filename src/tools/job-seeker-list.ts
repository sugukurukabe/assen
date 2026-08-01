/**
 * job_seeker_list：帳簿②の求職者氏名の選択肢を照会する。
 * job_seeker_list: lists selectable Ledger #2 job-seeker names.
 * job_seeker_list: menampilkan opsi nama pencari kerja Buku Besar #2.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { logMessage } from "../lib/logger.js";
import { LIST_OPTION_ALLOWED_ROLES } from "../services/list-options/allowed-roles.js";
import { listJobSeekers } from "../services/list-options/list-job-seekers.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";

const inputSchema = {
  query: z.string().optional().describe("氏名・staffIdの部分一致（カナ列は現スキーマにない） / Partial match against name or staffId (no kana column in current schema) / Cocok sebagian pada nama atau staffId (kolom kana belum ada di skema saat ini)"),
  status: z.enum(["active", "closed", "all"]).optional().describe("求職者状態（既定active）。closedはplacedとwithdrawn / Job-seeker status (default active); closed means placed plus withdrawn / Status pencari kerja (default active); closed berarti placed dan withdrawn"),
  limit: z.number().int().positive().max(100).optional().describe("最大件数（既定50・上限100） / Max rows (default 50, cap 100) / Maks baris (default 50, batas 100)"),
};

export function registerJobSeekerList(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "job_seeker_list",
    {
      title: "求職者候補を照会する",
      description:
        "帳簿②の求職者から、Slackフォームの候補者選択肢に使う求職者IDと氏名だけを返す。 / Lists only job-seeker IDs and names from Ledger #2 for Slack candidate options. / Menampilkan hanya ID pencari kerja dan nama dari Buku Besar #2 untuk opsi kandidat Slack.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        assertScope(context.principal, [...LIST_OPTION_ALLOWED_ROLES]);
        return toToolResult(await listJobSeekers(context.db, args));
      } catch (error) {
        logMessage("error", "job_seeker_listに失敗しました / job_seeker_list failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("求職者候補を取得できませんでした / Failed to list job-seeker options", "PII暗号鍵とDB接続を確認してください。");
      }
    },
  );
}

/**
 * job_order.list：S/A案件リスト照会
 * job_order.list: list S/A (or filtered) job orders
 * job_order.list: daftar lowongan S/A (atau terfilter)
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { listJobOrders } from "../services/job-orders/list-job-orders.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  grades: z
    .array(z.enum(["S", "A", "B", "C"]))
    .optional()
    .describe("絞り込み等級。省略時は全件（上限あり） / Grade filter; all (capped) when omitted / Filter grade; semua (dibatasi) jika dihilangkan"),
  status: z.enum(["open", "filled", "closed"]).optional().describe("求人ステータス / Job status / Status lowongan"),
  limit: z.number().int().positive().max(100).optional().describe("最大件数（既定50） / Max rows (default 50) / Maks baris (default 50)"),
};

export function registerJobOrderList(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "job_order_list",
    {
      title: "求人リストを照会する",
      description:
        "スコア等級（S/A/B/C）とステータスで求人を絞り込んで一覧する。オシンのS/A案件リスト・週次突合の入力に使う。 / Lists job orders filtered by score grade (S/A/B/C) and status. Used for Oshin's S/A target list and weekly matching. / Mendaftar lowongan difilter grade skor (S/A/B/C) dan status. Dipakai untuk daftar target S/A Oshin dan pencocokan mingguan.",
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
        assertScope(context.principal, ["requester", "admin", "approver"]);
        const result = await listJobOrders(context.db, {
          grades: args.grades,
          status: args.status,
          limit: args.limit,
        });
        return toToolResult(result);
      } catch (error) {
        logMessage("error", "job_order.listに失敗しました / job_order.list failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("求人リストの照会に失敗しました / Failed to list job orders", "再度お試しください。");
      }
    },
  );
}

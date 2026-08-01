/**
 * partner_list：取引先・派遣先会社名の選択肢を照会する。
 * partner_list: lists selectable partner/client company names.
 * partner_list: menampilkan opsi nama perusahaan partner/klien.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { logMessage } from "../lib/logger.js";
import { LIST_OPTION_ALLOWED_ROLES } from "../services/list-options/allowed-roles.js";
import { listPartners } from "../services/list-options/list-partners.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";

const inputSchema = {
  query: z
    .string()
    .optional()
    .describe("正式社名・カナ・shortcutの部分一致 / Partial match against official name, kana, or shortcut / Cocok sebagian pada nama resmi, kana, atau shortcut"),
  status: z.enum(["active", "inactive", "all"]).optional().describe("取引先の使用状態（既定active） / Partner availability status (default active) / Status ketersediaan partner (default active)"),
  limit: z.number().int().positive().max(100).optional().describe("最大件数（既定50・上限100） / Max rows (default 50, cap 100) / Maks baris (default 50, batas 100)"),
};

export function registerPartnerList(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "partner_list",
    {
      title: "取引先候補を照会する",
      description:
        "freee会計の取引先から、Slackフォームの会社選択肢に使う安定IDと登記正式社名だけを返す。 / Lists stable IDs and official company labels from freee Accounting partners for Slack company options. / Menampilkan hanya ID stabil dan nama resmi perusahaan dari partner freee Accounting untuk opsi perusahaan Slack.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        assertScope(context.principal, [...LIST_OPTION_ALLOWED_ROLES]);
        return toToolResult(await listPartners(args));
      } catch (error) {
        logMessage("error", "partner_listに失敗しました / partner_list failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "取引先候補を取得できませんでした / Failed to list partner options",
          "freee OAuth・Secret Manager・freee取引先のavailable設定を確認してください。空配列ではなく接続失敗として扱ってください。",
        );
      }
    },
  );
}

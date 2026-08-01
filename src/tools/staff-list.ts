/**
 * staff_list：就業中スタッフ氏名の選択肢を照会する。
 * staff_list: lists selectable employed staff names.
 * staff_list: menampilkan opsi nama staf yang sedang bekerja.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { logMessage } from "../lib/logger.js";
import { LIST_OPTION_ALLOWED_ROLES } from "../services/list-options/allowed-roles.js";
import { listStaff } from "../services/list-options/list-staff.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";

const inputSchema = {
  query: z
    .string()
    .optional()
    .describe("氏名・社員番号・staffIdの部分一致（カナ列はfreee人事労務から取得しないため未対応） / Partial match against name, employee number, or staffId (kana is not fetched from freee HR, so it is not supported) / Cocok sebagian pada nama, nomor karyawan, atau staffId (kana tidak diambil dari freee HR sehingga tidak didukung)"),
  status: z.enum(["active", "retired", "all"]).optional().describe("在籍状態（既定active） / Employment status (default active) / Status kerja (default active)"),
  limit: z.number().int().positive().max(100).optional().describe("最大件数（既定50・上限100） / Max rows (default 50, cap 100) / Maks baris (default 50, batas 100)"),
};

export function registerStaffList(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "staff_list",
    {
      title: "スタッフ候補を照会する",
      description:
        "freee人事労務の従業員から、Slackフォームの氏名選択肢に使うstaffIdと表示名だけを返す。 / Lists staffId and display labels from freee HR employees for Slack form name options. / Menampilkan hanya staffId dan label dari karyawan freee HR untuk opsi nama form Slack.",
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
        return toToolResult(await listStaff(args));
      } catch (error) {
        logMessage("error", "staff_listに失敗しました / staff_list failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "スタッフ候補を取得できませんでした / Failed to list staff options",
          "freee OAuth・Secret Manager・staffId対応表（社員番号numが空の従業員の上書き）を確認してください。空配列ではなく接続失敗として扱ってください。",
        );
      }
    },
  );
}

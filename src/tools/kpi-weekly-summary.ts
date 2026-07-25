/**
 * kpi.weekly_summary：週次5指標を集計する
 * kpi.weekly_summary: aggregates the weekly 5 metrics
 * kpi.weekly_summary: mengagregasi 5 indikator mingguan
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { computeWeeklyKpi, formatWeeklyKpiSlackText } from "../services/kpi/weekly-summary.js";
import { postSlackMessage } from "../lib/slack-notifier.js";
import { loadEnv } from "../lib/env.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  weekStart: z.string().optional().describe("週開始日(YYYY-MM-DD) / Week start / Awal minggu"),
  weekEnd: z.string().optional().describe("週終了日(YYYY-MM-DD) / Week end / Akhir minggu"),
  postToSlack: z
    .boolean()
    .optional()
    .describe("trueならSLACK_KPI_CHANNEL_IDへ投稿 / When true, post to SLACK_KPI_CHANNEL_ID / Jika true, posting ke SLACK_KPI_CHANNEL_ID"),
};

export function registerKpiWeeklySummary(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "kpi.weekly_summary",
    {
      title: "週次5指標を集計する",
      description:
        "直近1週間（または指定期間）の新規候補者・推薦・面接・内定・成約＋手数料を集計し、経路別内訳とレシオを返す。月曜ミーティング用。 / Aggregates new candidates, referrals, interviews, offers, placements + fees for the last week (or a given period), with per-channel breakdown and ratios. For the Monday meeting. / Mengagregasi kandidat baru, rekomendasi, wawancara, tawaran, penempatan + fee untuk seminggu terakhir (atau periode tertentu), dengan rincian per jalur dan rasio. Untuk rapat Senin.",
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
        const summary = await computeWeeklyKpi(context.db, {
          weekStart: args.weekStart,
          weekEnd: args.weekEnd,
        });
        const slackText = formatWeeklyKpiSlackText(summary);
        if (args.postToSlack) {
          const env = loadEnv();
          await postSlackMessage({ text: slackText, channelId: env.SLACK_KPI_CHANNEL_ID || undefined });
        }
        return toToolResult({ ...summary, slackText });
      } catch (error) {
        logMessage("error", "kpi.weekly_summaryに失敗しました / kpi.weekly_summary failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("週次KPIの集計に失敗しました / Failed to compute weekly KPI", "期間指定を確認して再実行してください。");
      }
    },
  );
}

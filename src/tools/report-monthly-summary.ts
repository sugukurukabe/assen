/**
 * report_monthly_summary：紹介事業部の月次実績を§10テンプレで集計する
 * report_monthly_summary: aggregates the monthly placement report using the §10 template
 * report_monthly_summary: mengagregasi laporan bulanan divisi penempatan dengan template §10
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { loadEnv } from "../lib/env.js";
import { postSlackMessage } from "../lib/slack-notifier.js";
import { computeWeeklyKpi } from "../services/kpi/weekly-summary.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  month: z.string().regex(/^\d{4}-\d{2}$/).describe("対象月(YYYY-MM) / Target month / Bulan target"),
  postToSlack: z.boolean().optional().describe("trueならSLACK_BOARD_CHANNEL_ID（#95相当）へ投稿 / When true, post to SLACK_BOARD_CHANNEL_ID / Jika true, posting ke SLACK_BOARD_CHANNEL_ID"),
};

function monthBounds(month: string): { start: string; end: string } {
  const start = `${month}-01`;
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(date.getUTCDate() - 1);
  return { start, end: date.toISOString().slice(0, 10) };
}

function formatMonthlyText(month: string, summary: Awaited<ReturnType<typeof computeWeeklyKpi>>): string {
  return [
    `月次実績まとめ ${month}`,
    `問い合わせ: ${summary.inquiries} / 正式申込セット送付: ${summary.applicationSetsSent} / セット受領: ${summary.applicationSetsReceived}`,
    `候補者登録: ${summary.newCandidates} / 推薦: ${summary.referrals} / 面接: ${summary.interviews} / 内定: ${summary.offers} / 成約: ${summary.placements}`,
    `確定手数料: ¥${summary.feeAmountInclTax.toLocaleString("ja-JP")}`,
    `成果区分別収益: ${JSON.stringify(summary.revenueByCategory)}`,
    `経路別ファネル: ${JSON.stringify(summary.channelFunnels)}`,
    `経路別問い合わせ: ${JSON.stringify(summary.inquiryByChannel)}`,
    `候補者経路別: ${JSON.stringify(summary.byChannel)}`,
    `事業区分別: ${JSON.stringify(summary.byBusinessFlag)}`,
    "学び: 決まった/流れた要因を3行で追記してください",
    "Catatan: tambahkan 3 baris pembelajaran tentang faktor berhasil/gagal.",
  ].join("\n");
}

export function registerReportMonthlySummary(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "report_monthly_summary",
    {
      title: "月次実績まとめを作成する",
      description:
        "紹介ローンチ設計書v1.2 §10の数え方で、問い合わせ→正式申込→推薦→面接→内定→成約と手数料を月次集計する。必要に応じて#95相当へ投稿する。 / Aggregates the monthly funnel and fees using Placement Launch Spec v1.2 §10. Can post to a #95-equivalent Slack channel. / Mengagregasi funnel bulanan dan fee sesuai Spesifikasi v1.2 §10, dan dapat diposting ke channel setara #95.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "admin", "approver"]);
        const { start, end } = monthBounds(args.month);
        const summary = await computeWeeklyKpi(context.db, { weekStart: start, weekEnd: end });
        const slackText = formatMonthlyText(args.month, summary);
        if (args.postToSlack) {
          const env = loadEnv();
          if (!env.SLACK_BOARD_CHANNEL_ID && env.NODE_ENV === "production") {
            throw new Error("SLACK_BOARD_CHANNEL_ID is required in production");
          }
          await postSlackMessage({ text: slackText, channelId: env.SLACK_BOARD_CHANNEL_ID || "" });
        }
        return toToolResult({
          operationId: randomUUID(),
          subjectId: args.month,
          subjectVersion: 1,
          status: "summarized",
          ...summary,
          slackText,
          missingFields: [],
          findings: [],
          evidenceRefs: [],
          nextActions: ["#95でボトルネックと翌月の勝ち型/停止広告を決めてください / Decide bottlenecks and next-month ad actions in #95"],
        });
      } catch (error) {
        logMessage("error", "report_monthly_summaryに失敗しました / report_monthly_summary failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("月次実績まとめに失敗しました / Failed to summarize monthly report", "monthの形式（YYYY-MM）を確認してください。");
      }
    },
  );
}

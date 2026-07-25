/**
 * 月曜30分ミーティング用：上流ファネル＋経路別転換率＋ボトルネック特定
 * Monday 30-min meeting: upstream funnel + channel conversion + bottleneck identification
 * Rapat Senin 30 menit: funnel awal + konversi per kanal + identifikasi bottleneck
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerWeeklyReviewPrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "weekly-review",
    {
      title: "週次レビュー（上流ファネルとボトルネック）",
      description:
        "kpi.weekly_summaryで問い合わせ→申込→候補者→成約の経路別転換率を読み上げ、落ちた段を1つだけ特定する月曜台本 / Monday script to read channel conversion from inquiry to application, candidate, and placement via kpi.weekly_summary / Naskah Senin membaca konversi per kanal dari inquiry ke lamaran, kandidat, dan placement via kpi.weekly_summary",
      argsSchema: {
        weekStart: z.string().optional().describe("週開始日(YYYY-MM-DD) / Week start / Awal minggu"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "月曜30分ミーティング（紹介ローンチ設計書§07）のアジェンダを回してください。",
              "0–5分: kpi_weekly_summaryを呼び出し、問い合わせ/正式申込セット送付/受領/候補者/推薦/面接/内定/成約＋確定/見込収益を読み上げ",
              "5–15分: 経路別ファネル（問い合わせ→送付→受領→候補者→成約）とレシオ（推薦→面接、面接→内定、内定→成約）からボトルネックを1段だけ選ぶ",
              "15–25分: job_order.list(grades=[\"S\"])と候補者を突合（建設監督のP2案件含む）",
              "25–30分: 壁判断が必要な事項（新規提携・手数料例外・グレーケース）を列挙",
              args.weekStart ? `対象週開始: ${args.weekStart}` : "対象週: 直近7日",
              "必要ならpostToSlack=trueで#15相当チャンネルへも投稿してください。",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

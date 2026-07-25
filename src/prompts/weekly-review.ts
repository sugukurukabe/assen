/**
 * 月曜30分ミーティング用：週次5指標＋ボトルネック特定
 * Monday 30-min meeting: weekly 5 metrics + bottleneck identification
 * Rapat Senin 30 menit: 5 indikator mingguan + identifikasi bottleneck
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerWeeklyReviewPrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "weekly-review",
    {
      title: "週次レビュー（5指標とボトルネック）",
      description:
        "kpi.weekly_summaryで5指標を読み上げ、ファネルの転換率が落ちた段を1つだけ特定する月曜台本 / Monday script to read the 5 metrics via kpi.weekly_summary and pick exactly one funnel stage whose conversion dropped / Naskah Senin membaca 5 indikator via kpi.weekly_summary dan memilih tepat satu tahap funnel yang konversinya turun",
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
              "0–5分: kpi.weekly_summaryを呼び出し、新規候補者/推薦/面接/内定/成約＋手数料を読み上げ",
              "5–15分: レシオ（推薦→面接、面接→内定、内定→成約）からボトルネックを1段だけ選ぶ",
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

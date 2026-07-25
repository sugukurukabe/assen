/**
 * 朝の3ソース求人スキャン〜S/Aリスト更新の台本（オシン日次09:00–09:15）
 * Script for the morning 3-source scan → S/A list update (Oshin's daily 09:00–09:15)
 * Naskah pindai 3 sumber pagi → perbarui daftar S/A (rutin harian Oshin 09:00–09:15)
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerMorningScanPrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "morning-scan",
    {
      title: "朝の求人スキャンとS/A更新",
      description:
        "Zキャリア・Ex-ord(Gmail)・#10インバウンドを同じ採点表で処理し、G1関所を通したS/A案件リストを更新する日次台本 / Daily script to score Z-Career, Ex-ord Gmail, and #10 inbound jobs with one scorecard / Naskah harian menilai Z-Career, Gmail Ex-ord, dan inbound #10 dengan tabel skor sama",
      argsSchema: {
        sourceNotes: z
          .string()
          .describe("3ソースから転記した求人メモ（Zキャリア/Ex-ord/#10） / Job notes from the three sources / Catatan lowongan dari 3 sumber"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "朝の15分ルーティン（紹介ローンチ設計書v1.2 §09）を実行してください。",
              "1. Zキャリア新着・GmailのEx-ord求人・#10_deal_deskインバウンドを同じ採点表で読む",
              "2. 必要ならjob_order_analyze→job_order_confirmで帳簿①へ登録（備考に提携元＋求人ID＋スコア）",
              "3. job_order_gate_checkで実作業ベースのG1監督職判定（建設現場作業・港湾はブロック）",
              "4. job_order_scoreで採点表v1.2（S≥9/A6–8、⑥レーン適合あり）を付ける",
              "5. job_order_list(grades=[\"S\",\"A\"], status=\"open\")で今週の推薦対象を確認",
              "6. Slackへは日次1スレッド「7/25 スキャン｜Z新着_件・Ex-ord_件｜S:_ A:_」形式で結果のみまとめる",
              "7. B/Cのうち建設監督系はrouteToP2Laneなら壁・吉原判断へ回す。それ以外は追わない",
              "",
              "求人メモ:",
              args.sourceNotes,
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

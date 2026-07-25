/**
 * 朝のZキャリアスキャン〜S/Aリスト更新の台本（オシン日次09:00–09:15）
 * Script for the morning Z-Career scan → S/A list update (Oshin's daily 09:00–09:15)
 * Naskah pindai Z-Career pagi → perbarui daftar S/A (rutin harian Oshin 09:00–09:15)
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
        "Zキャリア新着をスコアリングし、G1関所を通したS/A案件リストを更新する日次台本 / Daily script to score new Z-Career jobs, pass G1, and refresh the S/A list / Naskah harian menilai lowongan Z-Career baru, lolos G1, dan memperbarui daftar S/A",
      argsSchema: {
        zcareerNotes: z
          .string()
          .describe("Zキャリア画面から転記した新着求人メモ（内定率・書類通過率・応募数など） / Notes transcribed from the Z-Career screen / Catatan dari layar Z-Career"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "朝の15分ルーティン（紹介ローンチ設計書§07）を実行してください。",
              "1. 下記メモの各求人について、必要ならjob_order.analyze→confirmで帳簿①へ登録",
              "2. job_order.gate_checkで実作業ベースのG1監督職判定（建設現場・港湾はブロック）",
              "3. job_order.scoreで決めやすさスコア（S/A/B/C）を付ける",
              "4. job_order.list(grades=[\"S\",\"A\"], status=\"open\")で今週の推薦対象を確認",
              "5. B/Cのうち建設監督系はrouteToP2Laneなら壁・吉原判断へ回す。それ以外は追わない",
              "",
              "Zキャリアメモ:",
              args.zcareerNotes,
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

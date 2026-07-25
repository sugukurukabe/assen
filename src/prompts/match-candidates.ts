/**
 * 登録72時間以内のS/A案件×候補者突合台本
 * Script to match S/A jobs × candidates registered within 72 hours
 * Naskah mencocokkan order S/A × kandidat terdaftar dalam 72 jam
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerMatchCandidatesPrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "match-candidates",
    {
      title: "S/A案件と候補者を突合する",
      description:
        "登録から72時間以内の候補者に対しS/A案件を突合し、④⑤の後に推薦する台本 / Script to match S/A jobs to candidates within 72h of registration, then refer after ④⑤ / Naskah mencocokkan order S/A ke kandidat dalam 72 jam registrasi, lalu merekomendasikan setelah ④⑤",
      argsSchema: {
        focusNotes: z
          .string()
          .optional()
          .describe("今日の優先候補・案件メモ / Today's priority candidate/job notes / Catatan prioritas kandidat/order hari ini"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "候補者突合（紹介ローンチ設計書§05–06）を実行してください。",
              "1. job_order.list(grades=[\"S\",\"A\"], status=\"open\")でS/A案件を取得",
              "2. 直近72時間以内にinquiry.promoteまたはjob_seeker.confirmされた候補者を優先",
              "3. 必須要件とDM5問回答を1対1で照合（推測で埋めない）",
              "4. 適合する候補についてcompliance.evaluate（job_order）でG1通過を再確認",
              "5. ④求人条件明示書・⑤同意をdocument.generate_draft→承認→交付してからjob_order_referral.confirm",
              "6. 突合候補は最大3件まで提示し、オシンの判断材料として並べる",
              "",
              args.focusNotes ? `優先メモ: ${args.focusNotes}` : "優先メモ: （なし）",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

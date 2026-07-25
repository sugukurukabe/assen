/**
 * Stage 0問い合わせ対応の台本
 * Script for Stage 0 inquiry intake
 * Naskah untuk intake inquiry Stage 0
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerStage0IntakePrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "stage0-intake",
    {
      title: "Stage 0問い合わせを記録する",
      description:
        "スクリーナーがDM/WhatsApp/Metaリードから定型5問を取り、#15へ軽量メモを残し、正式申込セット送付と7日管理へ進む台本 / Script for recording Stage 0 inquiries and moving to the formal-set gate / Naskah mencatat inquiry Stage 0 dan lanjut ke gerbang paket resmi",
      argsSchema: {
        inquiryNotes: z.string().describe("問い合わせメモ（経路・日付・5問回答） / Inquiry notes / Catatan inquiry"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Stage 0問い合わせ対応を行ってください。",
              "1. DM5問（在留資格と期限/居住地/職歴・分野/日本語/希望）を確認",
              "2. inquiry_recordで#15_candidatesの軽量メモを作成（経路はWF-15Aの6択）",
              "3. 見込みがあれば正式申込セットを送付し、inquiry_update(setSent=true)で記録",
              "4. 未提出は7日でcloseStaleInquiries相当のクローズ対象。追いすぎない",
              "5. セット完備後のみinquiry_promoteで帳簿②へ昇格し、WF-15A起票条件を満たす",
              "",
              "問い合わせメモ:",
              args.inquiryNotes,
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

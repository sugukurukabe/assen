/**
 * 訂正版発行の業務フロープロンプト（否定形の指示にも対応する golden prompt 対象）
 * Workflow prompt for issuing a corrected document version (also a golden-prompt target for negated instructions)
 * Prompt workflow untuk menerbitkan versi dokumen yang dikoreksi (juga target golden-prompt untuk instruksi negasi)
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerCorrectDocumentPrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "correct-document",
    {
      title: "書類の訂正版を発行する",
      description:
        "document.supersedeで理由付きの訂正版を発行するワークフロー。旧版は絶対に直接書き換えない（改ざん防止の要）。 / Workflow that issues a corrected version via document.supersede with a mandatory reason. The old version must never be edited in place (core tamper-prevention control). / Workflow yang menerbitkan versi yang dikoreksi via document.supersede dengan alasan wajib. Versi lama tidak boleh diedit langsung (kontrol inti pencegahan perubahan).",
      argsSchema: {
        documentId: z.string().describe("訂正対象のdocument ID / Target documentId to correct / documentId target yang dikoreksi"),
        reason: z.string().describe("訂正理由 / Correction reason / Alasan koreksi"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `document ${args.documentId} を訂正してください。理由: ${args.reason}`,
              "重要: 既存のdocument行を直接UPDATEで書き換えてはいけません。",
              "必ずdocument.supersedeを呼び出し、新版（version+1）をdraftとして発行し、旧版をsupersededにしてください。",
              "新版が発行されたら、document.request_approval以降のフローを再度実行してください。",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

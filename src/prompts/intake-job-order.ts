/**
 * 求人取込〜帳簿確定までの業務フロープロンプト
 * Workflow prompt for job-order intake through ledger confirmation
 * Prompt workflow untuk intake lowongan hingga konfirmasi buku besar
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerIntakeJobOrderPrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "intake-job-order",
    {
      title: "求人を取り込んで帳簿①を確定する",
      description:
        "求人メールの原文からjob_order.analyze→人間確認→job_order.confirmの順で帳簿①を確定するワークフロー / Workflow that intakes a job-order email via job_order.analyze -> human review -> job_order.confirm to finalize Ledger #1 / Workflow yang menerima email lowongan via job_order.analyze -> tinjauan manusia -> job_order.confirm untuk finalisasi Buku Besar #1",
      argsSchema: {
        sourceText: z.string().describe("求人メールの原文全文 / Full text of the job-order email / Teks lengkap email lowongan"),
        sourceUri: z.string().describe("原文の参照URI / Reference URI of the source / URI referensi sumber"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "以下の求人メールを取り込み、帳簿①（求人管理簿）へ確定してください。",
              "1. job_order.analyzeを呼び出し、候補事実（fact_assertions）と欠落項目を確認する",
              "2. 欠落・低confidenceの項目をユーザーに確認する（LLMの推測をそのまま確定しない）",
              "3. 確認済みの値でjob_order.confirmを呼び出し、帳簿①へpostingする",
              "4. compliance.evaluateで法定必須項目の充足状況を確認する",
              "",
              `原文URI: ${args.sourceUri}`,
              "原文:",
              args.sourceText,
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

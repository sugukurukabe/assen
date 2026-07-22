/**
 * job_order.analyze：原文（求人メール等）を保存し、LLM抽出で候補事実を生成する。DB確定（帳簿posting）はしない
 * job_order.analyze: stores the raw source (job-order email etc.) and produces candidate facts via extraction. Never posts to the ledger
 * job_order.analyze: menyimpan sumber mentah (email lowongan dll.) dan menghasilkan kandidat fakta via ekstraksi. Tidak pernah posting ke buku besar
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { analyzeJobOrder } from "../services/extraction/analyze-job-order.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  sourceText: z
    .string()
    .min(1)
    .describe("求人メール等の原文全文。Full text of the job-order source (email, PDF-extracted text, etc.). Teks lengkap sumber lowongan (email, teks hasil ekstraksi PDF, dll.)."),
  sourceUri: z
    .string()
    .describe("原文の参照URI（Slackメッセージリンク、メールID等）。Reference URI of the source (Slack link, email id, etc.). URI referensi sumber (link Slack, id email, dll.)."),
};

export function registerJobOrderAnalyze(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "job_order.analyze",
    {
      title: "求人メールを解析する",
      description:
        "求人メール・PDF等の原文を不変保存し、LLM抽出で候補事実（fact_assertions）を生成する。帳簿への確定記帳は行わない（job_order.confirmを別途呼ぶこと）。 / Immutably stores the job-order source and extracts candidate facts (fact_assertions) via LLM. Never posts to the ledger (call job_order.confirm separately). / Menyimpan sumber lowongan secara tidak berubah dan mengekstrak kandidat fakta (fact_assertions) via LLM. Tidak pernah posting ke buku besar (panggil job_order.confirm secara terpisah).",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const result = await analyzeJobOrder(context.db, {
          tenantId: context.principal.tenantId,
          sourceText: args.sourceText,
          sourceUri: args.sourceUri,
        });

        return toToolResult({
          operationId: randomUUID(),
          sourceArtifactId: result.sourceArtifactId,
          contentHash: result.contentHash,
          facts: result.facts,
          missingFields: result.missingFields,
          nextActions:
            result.missingFields.length > 0
              ? [`不足項目を確認し、job_order.confirmで人間確認済みの値を渡してください: ${result.missingFields.join(", ")}`]
              : ["job_order.confirmを呼び出して帳簿①へ確定してください"],
        });
      } catch (error) {
        logMessage("error", "job_order.analyzeに失敗しました / job_order.analyze failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "求人メールの解析に失敗しました / Failed to analyze the job-order source",
          "原文の形式を確認し、再度お試しください。問題が続く場合はシステム管理者にご連絡ください。",
        );
      }
    },
  );
}

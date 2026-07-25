/**
 * job_order.gate-check：職安法G1監督職判定（実作業ベース）＋任意でG6的確表示チェック
 * job_order.gate-check: ESA G1 supervisor assessment (actual-duties based) + optional G6 accurate-representation check
 * job_order.gate-check: penilaian pengawas G1 ESA (berdasarkan tugas aktual) + cek tampilan akurat G6 opsional
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { gateCheckJobOrder } from "../services/job-orders/gate-check-job-order.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const inputSchema = {
  jobOrderId: z.string().uuid().describe("判定対象の求人ID / Job order id to assess / ID lowongan yang dinilai"),
  actualDuties: z
    .string()
    .min(1)
    .describe("実作業内容（肩書ではなく実態。G1の正） / Actual duties (reality, not title; authoritative for G1) / Tugas aktual (kenyataan, bukan jabatan; berwenang untuk G1)"),
  jobTitle: z.string().optional().describe("求人票の肩書（参考） / Job title on the posting (reference) / Jabatan di lowongan (acuan)"),
  adCopy: z
    .string()
    .optional()
    .describe("広告文（G6お祝い金等の禁止表現チェック用） / Ad copy for G6 forbidden-phrase check / Teks iklan untuk cek frasa terlarang G6"),
};

export function registerJobOrderGateCheck(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "job_order.gate_check",
    {
      title: "職安法G1監督職判定を行う",
      description:
        "建設現場作業・港湾運送の紹介禁止（職安法32条の11）を実作業ベースで判定する。肩書「監督」でも実態が現場作業ならfail。任意で広告文の的確表示（G6）も検査する。 / Assesses the ESA Art. 32-11 ban on placing construction-site labor and port work by actual duties. A supervisor title with site-labor reality fails. Optionally checks ad copy for G6 accurate representation. / Menilai larangan penyaluran kerja lapangan konstruksi dan pelabuhan (UU Psl. 32-11) berdasarkan tugas aktual. Jabatan pengawas dengan kenyataan kerja lapangan = fail. Opsional memeriksa teks iklan untuk tampilan akurat G6.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "admin", "approver"]);
        const result = await gateCheckJobOrder(context.db, {
          jobOrderId: args.jobOrderId,
          actualDuties: args.actualDuties,
          jobTitle: args.jobTitle,
          adCopy: args.adCopy,
        });
        const blocking = [...result.findings, ...result.g6Findings].filter((f) => f.severity === "blocking");
        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobOrderId,
          subjectVersion: 1,
          status: result.result,
          matchedKeywords: result.matchedKeywords,
          rationale: result.rationale,
          missingFields: blocking.flatMap((f) => f.missingFields),
          findings: [...result.findings, ...result.g6Findings],
          evidenceRefs: [`assen://legal-rules/esa-gates/v1`],
          nextActions:
            result.result === "allowed_supervisor" && blocking.length === 0
              ? ["job_order.scoreで決めやすさスコアを付け、S/Aリストへ / Score ease-of-close via job_order.score and add to S/A list"]
              : ["紹介を進める前に実作業を再確認するか、壁判断へ回してください / Re-check actual duties or escalate to Kabe before placing"],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "job_order.gate_checkに失敗しました / job_order.gate_check failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "監督職判定に失敗しました / Failed to run the supervisor gate check",
          "入力内容を確認し、再度お試しください。",
        );
      }
    },
  );
}

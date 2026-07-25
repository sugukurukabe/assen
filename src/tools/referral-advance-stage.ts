/**
 * referral.advance_stage：選考段階を進めてKPIファネルを計測可能にする
 * referral.advance_stage: advances selection stage so the KPI funnel can be measured
 * referral.advance_stage: memajukan tahap seleksi agar funnel KPI dapat diukur
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { advanceSelectionStage } from "../services/referrals/advance-selection-stage.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const inputSchema = {
  jobOrderReferralId: z.string().uuid(),
  selectionStage: z.enum(["registered", "screening", "interview", "offer"]).describe(
    "次の選考段階（placedはplacement.confirmのみ） / Next selection stage (placed only via placement.confirm) / Tahap berikutnya (placed hanya via placement.confirm)",
  ),
  stageDate: z.string().describe("段階到達日(YYYY-MM-DD) / Stage date / Tanggal tahap"),
};

export function registerReferralAdvanceStage(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "referral.advance_stage",
    {
      title: "選考段階を進める",
      description:
        "紹介行の選考段階（登録→書類選考→面接→内定）を進める。週次KPIの面接・内定カウントの正本。成約（placed）はplacement.confirmのみ。 / Advances the referral selection stage (registered→screening→interview→offer). Source of truth for weekly KPI interview/offer counts. placed is only via placement.confirm. / Memajukan tahap seleksi rujukan. Sumber kebenaran hitungan wawancara/tawaran KPI mingguan. placed hanya via placement.confirm.",
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
        assertScope(context.principal, ["requester", "admin"]);
        const result = await advanceSelectionStage(context.db, args);
        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobOrderReferralId,
          subjectVersion: 1,
          status: "stage_advanced",
          selectionStage: result.selectionStage,
          stageDate: result.stageDate,
          missingFields: [],
          findings: [],
          evidenceRefs: [],
          nextActions: [],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "referral.advance_stageに失敗しました / referral.advance_stage failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("選考段階の更新に失敗しました / Failed to advance selection stage", "入力を確認してください。");
      }
    },
  );
}

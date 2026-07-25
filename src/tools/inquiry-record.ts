/**
 * inquiry.record：Stage 0問い合わせを記録しDM5問の充足を判定する
 * inquiry.record: records a Stage 0 inquiry and judges DM 5-question completeness
 * inquiry.record: mencatat inquiry Stage 0 dan menilai kelengkapan 5 pertanyaan DM
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { recordInquiry } from "../services/inquiries/inquiry-lifecycle.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const dmAnswersSchema = z.object({
  visaStatus: z.string().optional().describe("在留資格 / Visa status / Status visa"),
  visaExpiry: z.string().optional().describe("在留期限(YYYY-MM-DD) / Visa expiry / Masa berlaku visa"),
  residence: z.string().optional().describe("居住地 / Residence / Domisili"),
  workHistory: z.string().optional().describe("職歴・分野 / Work history & field / Riwayat kerja & bidang"),
  japaneseLevel: z.string().optional().describe("日本語レベル / Japanese level / Level bahasa Jepang"),
  careerGoal: z.string().optional().describe("希望（直接雇用/派遣/相談） / Goal (direct/dispatch/consult) / Tujuan"),
});

const inputSchema = {
  displayName: z.string().min(1).describe("表示名（軽量メモ） / Display name (lightweight memo) / Nama tampilan"),
  channel: z
    .enum(["sugukuru_job", "win_job", "sns_application", "other_agency", "direct_referral", "internal_conversion"])
    .describe("応募経路（6択。Zキャリアは求人側のため含まない） / Application channel (6 options; Z-Career is on the job side) / Jalur lamaran (6 opsi)"),
  dmAnswers: dmAnswersSchema.optional().describe("DM5問回答 / DM 5-question answers / Jawaban 5 pertanyaan DM"),
  notes: z.string().optional().describe("メモ / Notes / Catatan"),
};

export function registerInquiryRecord(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "inquiry.record",
    {
      title: "問い合わせ（Stage 0）を記録する",
      description:
        "正式申込セット受領前の反応者を問い合わせとして記録する。DM5問が揃うまでパイプライン（候補者）には載せない。 / Records a responder as an inquiry before the formal application set. Does not enter the candidate pipeline until the 5 DM answers are complete. / Mencatat responden sebagai inquiry sebelum paket resmi. Tidak masuk pipeline kandidat sampai 5 jawaban DM lengkap.",
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "admin"]);
        const result = await recordInquiry(context.db, {
          tenantId: context.principal.tenantId,
          displayName: args.displayName,
          channel: args.channel,
          dmAnswers: args.dmAnswers,
          notes: args.notes,
        });
        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.inquiryId,
          subjectVersion: 1,
          status: result.status,
          dmComplete: result.dmComplete,
          missingFields: [],
          findings: [],
          evidenceRefs: [],
          nextActions: result.nextActions,
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "inquiry.recordに失敗しました / inquiry.record failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("問い合わせの記録に失敗しました / Failed to record the inquiry", "入力を確認して再実行してください。");
      }
    },
  );
}

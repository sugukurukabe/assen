/**
 * inquiry.update：申込セット送付・書類受領・7日自動クローズ
 * inquiry.update: application-set send, document receipt, 7-day auto-close
 * inquiry.update: kirim paket, penerimaan dokumen, tutup otomatis 7 hari
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { updateInquiry } from "../services/inquiries/inquiry-lifecycle.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const dmAnswersSchema = z.object({
  visaStatus: z.string().optional(),
  visaExpiry: z.string().optional(),
  residence: z.string().optional(),
  workHistory: z.string().optional(),
  japaneseLevel: z.string().optional(),
  careerGoal: z.string().optional(),
});

const inputSchema = {
  inquiryId: z.string().uuid().describe("問い合わせID / Inquiry id / ID inquiry"),
  dmAnswers: dmAnswersSchema.optional(),
  setSent: z.boolean().optional().describe("正式申込セットを送付した / Formal application set was sent / Paket resmi telah dikirim"),
  hasApplicationForm: z.boolean().optional().describe("①求職申込書受領 / Application form received / Formulir permohonan diterima"),
  hasResume: z.boolean().optional().describe("②履歴書受領 / Resume received / CV diterima"),
  hasResidenceCard: z.boolean().optional().describe("③在留カード両面受領 / Residence card (both sides) received / Kartu izin tinggal (dua sisi) diterima"),
  hasQualificationDocs: z.boolean().optional().describe("④資格・成績書類受領 / Qualification docs received / Dokumen kualifikasi diterima"),
  hasT2pPriorConsent: z.boolean().optional().describe("⑤T2P事前同意書受領 / T2P prior consent received / Persetujuan awal T2P diterima"),
  wantsT2p: z.boolean().optional().describe("紹介予定派遣を希望 / Wants T2P / Ingin T2P"),
  setReceivedAt: z.string().optional().describe("セット受領日(YYYY-MM-DD) / Set receipt date / Tanggal terima paket"),
  notes: z.string().optional(),
  sourceTag: z
    .string()
    .optional()
    .describe(
      "流入元タグを後から付ける・貼り替える（例: meta_lead_form）。記録時に分からなかった経路が判明したときに使う / Sets or corrects the source tag afterwards (e.g. meta_lead_form) / Menetapkan atau mengoreksi tag sumber setelahnya",
    ),
  sourceDetail: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "広告セットID・キャンペーン名などの内訳を追記する（既存キーは上書き、最大8キー）。個人情報を入れない / Merges campaign/ad-set breakdown (existing keys overwritten, max 8). No personal data / Menggabungkan rincian kampanye (kunci lama ditimpa, maks 8). Jangan masukkan data pribadi",
    ),
  autoCloseStale: z.boolean().optional().describe("7日無応答なら自動クローズ（既定true） / Auto-close after 7 days (default true) / Tutup otomatis setelah 7 hari (default true)"),
};

export function registerInquiryUpdate(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "inquiry_update",
    {
      title: "問い合わせを更新する",
      description:
        "DM回答・正式申込セット送付・書類受領フラグ・流入元タグを更新する。set_sentから7日たってもセット未完備なら自動クローズ（追いかけない）。 / Updates DM answers, application-set send, receipt flags, and the source tag. Auto-closes if the set is still incomplete 7 days after set_sent (do not chase). / Memperbarui jawaban DM, pengiriman paket, flag penerimaan, dan tag sumber. Tutup otomatis jika paket belum lengkap 7 hari setelah set_sent (jangan dikejar).",
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
        const result = await updateInquiry(context.db, args);
        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.inquiryId,
          subjectVersion: 1,
          status: result.status,
          dmComplete: result.dmComplete,
          applicationSetComplete: result.applicationSetComplete,
          sourceTag: result.sourceTag,
          autoClosed: result.autoClosed,
          missingFields: [],
          findings: [],
          evidenceRefs: [],
          nextActions: result.nextActions,
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "inquiry.updateに失敗しました / inquiry.update failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("問い合わせの更新に失敗しました / Failed to update the inquiry", "入力を確認して再実行してください。");
      }
    },
  );
}

/**
 * inquiry.promote：正式申込セット完備で候補者（帳簿②）へ昇格する唯一の経路
 * inquiry.promote: the only path that promotes a complete formal set into a candidate (Ledger #2)
 * inquiry.promote: satu-satunya jalur yang mempromosikan paket lengkap menjadi kandidat (Buku Besar #2)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { promoteInquiry } from "../services/inquiries/inquiry-lifecycle.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const inputSchema = {
  idempotencyKey: z.string().min(1).describe("冪等キー / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("昇格理由 / Promote reason / Alasan promote"),
  inquiryId: z.string().uuid().describe("問い合わせID / Inquiry id / ID inquiry"),
  seeker: z.object({
    staffId: z.string().optional(),
    name: z.string().describe("氏名（在留カード表記） / Name (residence-card spelling) / Nama (ejaan kartu izin tinggal)"),
    address: z.string(),
    birthDate: z.string().describe("生年月日(YYYY-MM-DD) / Birth date / Tanggal lahir"),
    nationality: z.string().optional(),
  }),
  piiConsent: z.object({
    consentDate: z.string(),
    scope: z.string(),
    recipients: z.string(),
  }),
  fields: z.object({
    desiredOccupation: z.string(),
    acceptedAt: z.string().describe("求職受理日。省略時はセット受領日を使う / Acceptance date; defaults to set receipt date / Tanggal penerimaan; default tanggal terima paket"),
    validUntil: z.string(),
  }),
};

export function registerInquiryPromote(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "inquiry_promote",
    {
      title: "問い合わせを候補者へ昇格する",
      description:
        "正式申込セットが揃った問い合わせだけを帳簿②（求職管理簿）へ昇格する。受領日＝登録日＝求職受理日。WF-15A起票条件の正本。 / Promotes only inquiries with a complete formal application set into Ledger #2. Receipt date = registration date = seeker acceptance date. Source of truth for the WF-15A trigger. / Hanya mempromosikan inquiry dengan paket resmi lengkap ke Buku Besar #2. Tanggal terima = tanggal registrasi = tanggal penerimaan pencari kerja. Sumber kebenaran pemicu WF-15A.",
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
        const result = await promoteInquiry(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          idempotencyKey: args.idempotencyKey,
          reason: args.reason,
          inquiryId: args.inquiryId,
          seeker: args.seeker,
          piiConsent: args.piiConsent,
          fields: args.fields,
        });
        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobSeekerId,
          subjectVersion: 1,
          status: result.alreadyProcessed ? "already_promoted" : "promoted",
          inquiryId: result.inquiryId,
          applicationChannel: result.applicationChannel,
          acceptedAt: result.acceptedAt,
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://audit/job_seeker/${result.jobSeekerId}`],
          nextActions: [
            "72時間以内にS/A案件と突合し初回求人提案を行ってください / Match S/A jobs within 72 hours and make the first job proposal",
            "job_order.gate_checkと④⑤交付後にjob_order_referral.confirmへ / After gate_check and docs ④⑤, proceed to job_order_referral.confirm",
          ],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "inquiry.promoteに失敗しました / inquiry.promote failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("候補者への昇格に失敗しました / Failed to promote the inquiry", "入力と申込セットの充足を確認してください。");
      }
    },
  );
}

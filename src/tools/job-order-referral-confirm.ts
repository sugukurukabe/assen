/**
 * job_order_referral.confirm：確定済みの求人・求職者を紐付け、紹介行（帳簿①②の接点）をposting（write系。idempotency_key/reason必須）
 * job_order_referral.confirm: links a confirmed job order and job seeker, posting the referral row (Ledger #1/#2 junction) (write tool; requires idempotency_key/reason)
 * job_order_referral.confirm: menghubungkan lowongan dan pencari kerja yang dikonfirmasi, posting baris rujukan (titik temu Buku Besar #1/#2) (tool write; memerlukan idempotency_key/reason)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { confirmJobOrderReferral } from "../services/documents/confirm-job-order-referral.js";
import { t2pReferralConditionsInputSchema } from "../domain/t2p-referral-conditions.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const inputSchema = {
  idempotencyKey: z.string().min(1).describe("冪等キー。同一操作の再実行で副作用を1回に保つ / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("確定理由 / Reason for confirmation / Alasan konfirmasi"),
  jobOrderId: z.string().uuid().describe("job_order.confirmで確定済みの求人ID / Job order id finalized via job_order.confirm / Id lowongan yang difinalisasi via job_order.confirm"),
  jobSeekerId: z.string().uuid().describe("job_seeker.confirmで確定済みの求職者ID / Job seeker id finalized via job_seeker.confirm / Id pencari kerja yang difinalisasi via job_seeker.confirm"),
  referredAt: z.string().min(1).describe("紹介日(YYYY-MM-DD) / Referral date / Tanggal rujukan"),
  type: z.enum(["t2p", "pure", "direct"]).describe("紹介区分（紹介予定派遣／純粋紹介／直接） / Referral category (T2P / pure referral / direct) / Kategori rujukan (T2P / rujukan murni / langsung)"),
  conditionsTyped: t2pReferralConditionsInputSchema
    .partial()
    .optional()
    .describe(
      "④求人条件明示書・⑤本人同意書の差込用項目（この時点で分かる範囲。⑦⑧⑨分はplacement.confirm/placement.record_rejection_reasonが追記する） / Fields for ④/⑤ (as much as known at this point; ⑦/⑧/⑨ fields are appended later by placement.confirm/placement.record_rejection_reason) / Field untuk ④/⑤ (sejauh yang diketahui saat ini; field ⑦/⑧/⑨ ditambahkan nanti oleh placement.confirm/placement.record_rejection_reason)",
    ),
  dispatchAssignmentId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "⑥T2P個別契約書（t2pFlag=true）のdispatch_assignment.confirm結果ID（任意・後から紐付け可） / dispatch_assignment.confirm result id for the ⑥ T2P individual contract (t2pFlag=true), optional and linkable later / Id hasil dispatch_assignment.confirm untuk kontrak individual T2P ⑥ (t2pFlag=true), opsional dan dapat dihubungkan nanti",
    ),
};

export function registerJobOrderReferralConfirm(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "job_order_referral.confirm",
    {
      title: "求人と求職者の紹介行を確定し紹介欄へ記帳する",
      description:
        "確定済みのjob_order・job_seekerを紐付け、job_order_referrals（帳簿①②の接点＝紹介欄）へpostingする。confirmed_byは認証主体から導出する。確定後はdocument.generate_draft（docType=t2p_job_order_notice/t2p_consent_form）で④⑤書類を生成できる。 / Links a confirmed job_order and job_seeker, posting job_order_referrals (the Ledger #1/#2 junction, i.e. the referral columns). confirmed_by is derived from the authenticated principal. Once confirmed, document.generate_draft (docType=t2p_job_order_notice/t2p_consent_form) can generate documents ④/⑤. / Menghubungkan job_order dan job_seeker yang dikonfirmasi, posting job_order_referrals (titik temu Buku Besar #1/#2, yaitu kolom rujukan). confirmed_by diturunkan dari principal terautentikasi. Setelah dikonfirmasi, document.generate_draft (docType=t2p_job_order_notice/t2p_consent_form) dapat menghasilkan dokumen ④/⑤.",
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

        const result = await confirmJobOrderReferral(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          idempotencyKey: args.idempotencyKey,
          reason: args.reason,
          jobOrderId: args.jobOrderId,
          jobSeekerId: args.jobSeekerId,
          referredAt: args.referredAt,
          type: args.type,
          conditionsTyped: args.conditionsTyped,
          dispatchAssignmentId: args.dispatchAssignmentId,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobOrderReferralId,
          subjectVersion: 1,
          status: result.alreadyProcessed ? "already_confirmed" : "confirmed",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://audit/job_order_referral/${result.jobOrderReferralId}`],
          nextActions: [
            "document.previewでdocType=t2p_job_order_notice/t2p_consent_formのプレビューを確認してください",
            "placement.confirmで採否を確定してください（採用/不採用が判明した時点）",
          ],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "job_order_referral.confirmに失敗しました / job_order_referral.confirm failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "紹介行の確定に失敗しました / Failed to confirm the referral",
          "入力内容を確認し、再度お試しください。問題が続く場合はシステム管理者にご連絡ください。",
        );
      }
    },
  );
}

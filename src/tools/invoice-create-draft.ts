/**
 * invoice_create_draft：freee本登録前の請求ドラフトを永続化する
 * invoice_create_draft: persists an invoice draft before freee posting
 * invoice_create_draft: menyimpan draf tagihan sebelum posting ke freee
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { feeInvoiceDrafts, jobOrderReferrals } from "../db/schema/ledgers.js";
import { transactionalOutbox } from "../db/schema/outbox.js";
import { appendAuditEvent } from "../audit/hash-chain.js";
import { canonicalJsonString, sha256Hex } from "../lib/hash.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const inputSchema = {
  idempotencyKey: z.string().min(1).describe("冪等キー / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("請求ドラフト作成理由 / Reason / Alasan"),
  referralId: z.string().uuid().describe("紹介行ID / Referral id / ID rujukan"),
  feeRecordId: z.string().uuid().optional().describe("手数料管理簿ID（未確定なら省略） / Fee record id when available / ID catatan biaya jika ada"),
  payerCompanyId: z.string().min(1).describe("請求先企業ID / Payer company id / ID perusahaan pembayar"),
  payerName: z.string().min(1).describe("請求先名 / Payer name / Nama pembayar"),
  amountInclTax: z.number().positive().optional().describe("税込請求額（協議中なら省略） / Amount including tax, omit while pending / Jumlah termasuk pajak"),
  feeStatus: z.enum(["billable", "pending_negotiation", "on_hold"]).default("billable").describe("手数料ステータス / Fee status / Status biaya"),
  title: z.string().min(1).default("紹介手数料請求ドラフト").describe("件名 / Title / Judul"),
  bodyText: z.string().min(1).describe("請求ドラフト本文 / Invoice draft body / Isi draf tagihan"),
};

export function registerInvoiceCreateDraft(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "invoice_create_draft",
    {
      title: "請求ドラフトを保存する",
      description:
        "placement_confirmの結果や手動協議結果から、freee本登録前の請求ドラフトをAssenに保存する。P5/WIN移行で手数料協議中の場合はfeeStatus=pending_negotiationで金額未定のまま保存できる。 / Stores a fee invoice draft before freee posting. For P5/WIN transitions under negotiation, save with feeStatus=pending_negotiation and no amount. / Menyimpan draf tagihan sebelum posting freee. Untuk P5/WIN yang masih dimusyawarahkan, simpan dengan feeStatus=pending_negotiation tanpa nominal.",
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
        const draftId = await context.db.transaction(async (tx) => {
          const [existingOutbox] = await tx
            .select()
            .from(transactionalOutbox)
            .where(eq(transactionalOutbox.idempotencyKey, args.idempotencyKey))
            .limit(1);
          if (existingOutbox?.externalReference) {
            return existingOutbox.externalReference;
          }

          const [referral] = await tx.select().from(jobOrderReferrals).where(eq(jobOrderReferrals.id, args.referralId));
          if (!referral) {
            throw new UserInputError(
              `referral ${args.referralId} が見つかりません / referral ${args.referralId} not found`,
              "referralIdを確認してください / Please verify referralId",
            );
          }
          const [existingDraft] = await tx
            .select()
            .from(feeInvoiceDrafts)
            .where(and(eq(feeInvoiceDrafts.referralId, args.referralId), eq(feeInvoiceDrafts.status, "draft")))
            .limit(1);
          if (existingDraft) {
            return existingDraft.id;
          }
          if (args.feeStatus === "billable" && args.amountInclTax === undefined) {
            throw new UserInputError(
              "feeStatus=billableの場合、amountInclTaxが必須です / amountInclTax is required when feeStatus=billable",
              "金額未定ならfeeStatus=pending_negotiationを指定してください / Use feeStatus=pending_negotiation when the amount is not fixed",
            );
          }

          const newDraftId = randomUUID();
          await tx.insert(feeInvoiceDrafts).values({
            id: newDraftId,
            tenantId: context.principal.tenantId,
            referralId: args.referralId,
            feeRecordId: args.feeRecordId,
            payerCompanyId: args.payerCompanyId,
            payerName: args.payerName,
            amountInclTax: args.amountInclTax?.toString(),
            feeStatus: args.feeStatus,
            title: args.title,
            bodyText: args.bodyText,
          });
          await appendAuditEvent(tx, {
            tenantId: context.principal.tenantId,
            aggregateType: "fee_invoice_draft",
            aggregateId: newDraftId,
            aggregateVersion: 1,
            eventType: "invoice.draft_created",
            afterHash: sha256Hex(canonicalJsonString({ draftId: newDraftId, referralId: args.referralId, feeStatus: args.feeStatus })),
            principal: context.principal,
            requestId: context.requestId,
          });
          await tx.insert(transactionalOutbox).values({
            tenantId: context.principal.tenantId,
            aggregateType: "fee_invoice_draft",
            aggregateId: newDraftId,
            eventType: "invoice.draft_created",
            payload: { draftId: newDraftId, referralId: args.referralId, reason: args.reason },
            idempotencyKey: args.idempotencyKey,
            externalReference: newDraftId,
          });
          return newDraftId;
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: draftId,
          subjectVersion: 1,
          status: "drafted",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://audit/job_order_referral/${args.referralId}`],
          nextActions: ["#40_financeで吉原さんの承認後にfreee登録してください / Post to freee after Yoshihara approves in #40_finance"],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "invoice_create_draftに失敗しました / invoice_create_draft failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("請求ドラフトの保存に失敗しました / Failed to save invoice draft", "入力を確認して再実行してください。");
      }
    },
  );
}

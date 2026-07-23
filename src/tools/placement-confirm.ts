/**
 * placement.confirm：紹介行の採否（hired/rejected）を確定する（write系。idempotency_key/reason必須）。
 * hired時：転職勧奨禁止期間を自動計算し、party snapshot（takenReason: "placement_confirm"）を作成、
 * fee_records（帳簿③）へpostingする。rejected時：⑧書類生成の前提を整える
 *
 * placement.confirm: finalizes the hiring outcome (hired/rejected) of a referral row (write tool; requires
 * idempotency_key/reason). When hired: auto-computes the no-poaching period, creates a party snapshot
 * (takenReason: "placement_confirm"), and posts Ledger #3 (fee_records). When rejected: sets up the
 * precondition for generating document ⑧
 *
 * placement.confirm: finalisasi hasil perekrutan (hired/rejected) dari baris rujukan (tool write;
 * memerlukan idempotency_key/reason). Saat diterima: menghitung otomatis periode larangan pembajakan,
 * membuat snapshot pihak (takenReason: "placement_confirm"), dan posting Buku Besar #3 (fee_records).
 * Saat ditolak: menyiapkan prasyarat untuk menghasilkan dokumen ⑧
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { confirmPlacement } from "../services/documents/confirm-placement.js";
import { t2pReferralConditionsInputSchema } from "../domain/t2p-referral-conditions.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const employerSnapshotSchema = z.object({
  companyId: z.string().describe("企業ID / Company id / ID perusahaan"),
  name: z.string().describe("事業所名 / Establishment name / Nama perusahaan"),
  address: z.string().describe("所在地 / Address / Alamat"),
  representative: z.string().describe("代表者 / Representative / Perwakilan"),
  contactPerson: z.string().describe("担当者 / Contact person / Kontak person"),
});

const feeInputSchema = z.object({
  feeType: z.enum(["uketsuke", "todokede", "jogen"]).describe("手数料区分（受付時／届出制／上限制） / Fee type (intake/notification/capped) / Jenis biaya (penerimaan/notifikasi/batas atas)"),
  amountInclTax: z.number().positive().describe("手数料額（税込） / Fee amount incl. tax / Jumlah biaya termasuk pajak"),
  calcBasisWage: z.number().optional().describe("算定基礎賃金 / Wage used as calculation basis / Upah dasar perhitungan"),
  calcBasisRate: z.number().optional().describe("算定基礎率 / Rate used as calculation basis / Tarif dasar perhitungan"),
  collectedAt: z.string().optional().describe("実際の徴収年月日(YYYY-MM-DD) / Actual collection date / Tanggal penagihan aktual"),
});

const inputSchema = {
  idempotencyKey: z.string().min(1).describe("冪等キー。同一操作の再実行で副作用を1回に保つ / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("確定理由 / Reason for confirmation / Alasan konfirmasi"),
  jobOrderReferralId: z.string().uuid().describe("job_order_referral.confirmで確定済みの紹介行ID / Referral id finalized via job_order_referral.confirm / Id rujukan yang difinalisasi via job_order_referral.confirm"),
  outcome: z.enum(["hired", "rejected"]).describe("採否 / Hiring outcome / Hasil perekrutan"),
  hiredAt: z.string().optional().describe("採用年月日(YYYY-MM-DD)。outcome=hired時必須 / Hire date, required when outcome=hired / Tanggal perekrutan, wajib saat outcome=hired"),
  indefiniteEmployment: z.boolean().optional().describe("無期雇用か。outcome=hired時必須 / Whether employment is indefinite-term, required when outcome=hired / Apakah kontrak kerja tanpa batas waktu, wajib saat outcome=hired"),
  employer: employerSnapshotSchema.optional().describe("outcome=hired時必須（fee_recordsのpayer snapshotに使用） / Required when outcome=hired (used for the fee_records payer snapshot) / Wajib saat outcome=hired (digunakan untuk snapshot payer fee_records)"),
  conversionTerms: t2pReferralConditionsInputSchema
    .partial()
    .optional()
    .describe("outcome=hired時必須。⑦転換条件覚書の差込項目 / Required when outcome=hired. Fields for ⑦ conversion memo / Wajib saat outcome=hired. Field untuk memo konversi ⑦"),
  fee: feeInputSchema.optional().describe("outcome=hired時必須。帳簿③へpostingする手数料情報 / Required when outcome=hired. Fee info posted to Ledger #3 / Wajib saat outcome=hired. Info biaya yang diposting ke Buku Besar #3"),
  nonHireRequestDetails: t2pReferralConditionsInputSchema
    .partial()
    .optional()
    .describe("outcome=rejected時必須。⑧不採用理由の明示請求の差込項目 / Required when outcome=rejected. Fields for ⑧ non-hire-reason request / Wajib saat outcome=rejected. Field untuk permintaan alasan tidak diterima ⑧"),
};

export function registerPlacementConfirm(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "placement.confirm",
    {
      title: "採否を確定し帳簿③へ記帳する",
      description:
        "紹介行（job_order_referrals）の採否を確定する。hired時は転職勧奨禁止期間（採用日+2年）を自動計算し、party snapshotを作成、fee_records（帳簿③）へpostingする。rejected時は⑧不採用理由の明示請求書類の生成に必要な項目を記録する（回答受領後はplacement.record_rejection_reasonで⑨生成の前提を整える）。 / Finalizes the hiring outcome for a referral row (job_order_referrals). When hired, auto-computes the no-poaching period (hire date + 2 years), creates a party snapshot, and posts Ledger #3 (fee_records). When rejected, records the fields needed to generate document ⑧ (once the reply is received, placement.record_rejection_reason sets up the precondition for generating ⑨). / Finalisasi hasil perekrutan untuk baris rujukan (job_order_referrals). Saat diterima, menghitung otomatis periode larangan pembajakan (tanggal perekrutan + 2 tahun), membuat snapshot pihak, dan posting Buku Besar #3 (fee_records). Saat ditolak, mencatat field yang diperlukan untuk menghasilkan dokumen ⑧ (setelah balasan diterima, placement.record_rejection_reason menyiapkan prasyarat untuk menghasilkan ⑨).",
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

        if (args.outcome === "hired") {
          if (!args.hiredAt || args.indefiniteEmployment === undefined || !args.employer || !args.conversionTerms || !args.fee) {
            throw new UserInputError(
              "outcome=hiredの場合、hiredAt・indefiniteEmployment・employer・conversionTerms・feeが必須です / When outcome=hired, hiredAt, indefiniteEmployment, employer, conversionTerms, and fee are required",
              "採用が確定した時点で判明している項目をすべて指定してください / Please supply all fields that are known once hiring is finalized",
            );
          }
        } else if (!args.nonHireRequestDetails) {
          throw new UserInputError(
            "outcome=rejectedの場合、nonHireRequestDetailsが必須です / When outcome=rejected, nonHireRequestDetails is required",
            "⑧不採用理由の明示請求に必要な項目を指定してください / Please supply the fields needed for the ⑧ non-hire-reason request",
          );
        }

        const result = await confirmPlacement(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          idempotencyKey: args.idempotencyKey,
          reason: args.reason,
          jobOrderReferralId: args.jobOrderReferralId,
          outcomeInput:
            args.outcome === "hired"
              ? {
                  outcome: "hired",
                  hiredAt: args.hiredAt!,
                  indefiniteEmployment: args.indefiniteEmployment!,
                  employer: args.employer!,
                  conversionTerms: args.conversionTerms!,
                  fee: args.fee!,
                }
              : {
                  outcome: "rejected",
                  nonHireRequestDetails: args.nonHireRequestDetails!,
                },
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobOrderReferralId,
          subjectVersion: 2,
          status: result.alreadyProcessed ? "already_confirmed" : "confirmed",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://audit/job_order_referral/${result.jobOrderReferralId}`],
          nextActions:
            args.outcome === "hired"
              ? ["document.generate_draftでdocType=t2p_conversion_memo（⑦）を生成してください"]
              : [
                  "document.generate_draftでdocType=t2p_non_hire_reason_request（⑧）を生成してください",
                  "派遣先からの回答受領後はplacement.record_rejection_reasonで理由を記録してください",
                ],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "placement.confirmに失敗しました / placement.confirm failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "採否の確定に失敗しました / Failed to confirm the placement outcome",
          "入力内容を確認し、再度お試しください。問題が続く場合はシステム管理者にご連絡ください。",
        );
      }
    },
  );
}

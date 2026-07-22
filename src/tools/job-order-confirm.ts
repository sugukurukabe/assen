/**
 * job_order.confirm：検証済み事実からjob_orders確定＋帳簿①posting（write系。idempotency_key/reason必須）
 * job_order.confirm: finalizes job_orders from verified facts and posts Ledger #1 (write tool; requires idempotency_key/reason)
 * job_order.confirm: finalisasi job_orders dari fakta terverifikasi dan posting Buku Besar #1 (tool write; memerlukan idempotency_key/reason)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { confirmJobOrder } from "../services/documents/confirm-job-order.js";
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

const confirmFieldsSchema = z.object({
  acceptedAt: z.string().describe("受付年月日(YYYY-MM-DD) / Accepted date / Tanggal diterima"),
  validUntil: z.string().describe("有効期間(YYYY-MM-DD) / Valid-until date / Tanggal berlaku hingga"),
  headcount: z.number().int().positive().describe("求人数 / Headcount / Jumlah lowongan"),
  occupation: z.string().describe("職種 / Occupation / Jenis pekerjaan"),
  workLocation: z.string().describe("就業場所 / Work location / Lokasi kerja"),
  employmentPeriodType: z.enum(["indefinite", "fixed"]).describe("雇用形態 / Employment period type / Jenis periode kerja"),
  employmentPeriodDetail: z.string().optional(),
  wageAmountMin: z.number().optional(),
  wageAmountMax: z.number().optional(),
  wageUnit: z.enum(["hour", "day", "month", "year"]).describe("賃金単位 / Wage unit / Satuan upah"),
  t2pFlag: z.boolean().describe("紹介予定派遣か / Is this T2P / Apakah ini T2P"),
  refundSystem: z.boolean().describe("返戻金制度の有無 / Refund system present / Ada sistem pengembalian"),
  source: z.enum(["zcareer", "exord", "direct", "sns"]).describe("受理経路 / Intake source / Sumber intake"),
});

const inputSchema = {
  idempotencyKey: z.string().min(1).describe("冪等キー。同一操作の再実行で副作用を1回に保つ / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("確定理由 / Reason for confirmation / Alasan konfirmasi"),
  sourceArtifactId: z.string().uuid().describe("job_order.analyzeが返したsourceArtifactId / sourceArtifactId returned by job_order.analyze / sourceArtifactId yang dikembalikan job_order.analyze"),
  employer: employerSnapshotSchema,
  fields: confirmFieldsSchema,
};

export function registerJobOrderConfirm(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "job_order.confirm",
    {
      title: "求人を帳簿①へ確定する",
      description:
        "人間が検証済みの事実からjob_ordersを確定し、求人管理簿（帳簿①）へpostingする。confirmed_byは認証主体から導出する。 / Finalizes job_orders from human-verified facts and posts to the job-order ledger (Ledger #1). confirmed_by is derived from the authenticated principal. / Finalisasi job_orders dari fakta yang diverifikasi manusia dan posting ke buku besar lowongan (Buku Besar #1). confirmed_by diturunkan dari principal terautentikasi.",
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

        if (args.fields.wageAmountMin !== undefined && args.fields.wageAmountMax !== undefined) {
          if (args.fields.wageAmountMin > args.fields.wageAmountMax) {
            throw new UserInputError(
              "賃金の下限が上限を超えています / wageAmountMin exceeds wageAmountMax",
              "wageAmountMinとwageAmountMaxの値を確認してください / Please check the wageAmountMin and wageAmountMax values",
            );
          }
        }

        const result = await confirmJobOrder(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          idempotencyKey: args.idempotencyKey,
          reason: args.reason,
          sourceArtifactId: args.sourceArtifactId,
          employer: args.employer,
          fields: args.fields,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobOrderId,
          subjectVersion: 1,
          status: result.alreadyProcessed ? "already_confirmed" : "confirmed",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://audit/job_order/${result.jobOrderId}`],
          nextActions: ["compliance.evaluateで法定必須項目の充足状況を確認してください"],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "job_order.confirmに失敗しました / job_order.confirm failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "求人の確定に失敗しました / Failed to confirm the job order",
          "入力内容を確認し、再度お試しください。問題が続く場合はシステム管理者にご連絡ください。",
        );
      }
    },
  );
}

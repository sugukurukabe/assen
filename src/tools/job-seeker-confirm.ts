/**
 * job_seeker.confirm：検証済み事実からjob_seekers確定＋帳簿②posting（write系。idempotency_key/reason必須）
 * job_seeker.confirm: finalizes job_seekers from verified facts and posts Ledger #2 (write tool; requires idempotency_key/reason)
 * job_seeker.confirm: finalisasi job_seekers dari fakta terverifikasi dan posting Buku Besar #2 (tool write; memerlukan idempotency_key/reason)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { confirmJobSeeker } from "../services/documents/confirm-job-seeker.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const seekerSchema = z.object({
  staffId: z.string().optional().describe("既存スタッフID（特定技能スタッフの場合、任意） / Existing staff id (optional, for Specified Skilled Worker staff) / ID staf yang ada (opsional, untuk staf Tenaga Kerja Terampil Khusus)"),
  name: z.string().min(1).describe("氏名（暗号化して保存） / Full name (stored encrypted) / Nama lengkap (disimpan terenkripsi)"),
  address: z.string().min(1).describe("住所（暗号化して保存） / Address (stored encrypted) / Alamat (disimpan terenkripsi)"),
  birthDate: z.string().min(1).describe("生年月日(YYYY-MM-DD、暗号化して保存) / Birth date (stored encrypted) / Tanggal lahir (disimpan terenkripsi)"),
  nationality: z.string().optional().describe("国籍（スナップショットのみ、暗号化しない） / Nationality (snapshot only, not encrypted) / Kewarganegaraan (hanya snapshot, tidak dienkripsi)"),
});

const piiConsentSchema = z.object({
  consentDate: z.string().min(1).describe("個人情報取扱いへの同意日 / Date of PII-handling consent / Tanggal persetujuan penanganan PII"),
  scope: z.string().min(1).describe("同意の範囲 / Scope of consent / Lingkup persetujuan"),
  recipients: z.string().min(1).describe("提供先（派遣先・行政書士等） / Recipients (client company, gyoseishoshi, etc.) / Penerima (perusahaan klien, gyoseishoshi, dll.)"),
});

const fieldsSchema = z.object({
  desiredOccupation: z.string().min(1).describe("希望職種 / Desired occupation / Pekerjaan yang diinginkan"),
  acceptedAt: z.string().min(1).describe("受付年月日(YYYY-MM-DD) / Accepted date / Tanggal diterima"),
  validUntil: z.string().min(1).describe("有効期間満了日(YYYY-MM-DD) / Valid-until date / Tanggal berlaku hingga"),
});

const inputSchema = {
  idempotencyKey: z.string().min(1).describe("冪等キー。同一操作の再実行で副作用を1回に保つ / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("確定理由 / Reason for confirmation / Alasan konfirmasi"),
  seeker: seekerSchema,
  piiConsent: piiConsentSchema,
  fields: fieldsSchema,
};

export function registerJobSeekerConfirm(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "job_seeker.confirm",
    {
      title: "求職者を確定し求職管理簿へ記帳する",
      description:
        "人間が検証済みの事実からjob_seekersを確定し、求職管理簿（帳簿②）へpostingする。氏名・住所・生年月日はアプリ層で暗号化して保存する。confirmed_byは認証主体から導出する。確定後はjob_order_referral.confirmで求人への紹介行を作成できる。 / Finalizes job_seekers from human-verified facts and posts Ledger #2 (job-seeker ledger). Name/address/birth date are stored application-layer encrypted. confirmed_by is derived from the authenticated principal. Once confirmed, job_order_referral.confirm can create the referral row against a job order. / Finalisasi job_seekers dari fakta yang diverifikasi manusia dan posting Buku Besar #2 (buku besar pencari kerja). Nama/alamat/tanggal lahir disimpan terenkripsi di lapisan aplikasi. confirmed_by diturunkan dari principal terautentikasi. Setelah dikonfirmasi, job_order_referral.confirm dapat membuat baris rujukan terhadap lowongan.",
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

        const result = await confirmJobSeeker(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          idempotencyKey: args.idempotencyKey,
          reason: args.reason,
          seeker: args.seeker,
          piiConsent: args.piiConsent,
          fields: args.fields,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobSeekerId,
          subjectVersion: 1,
          status: result.alreadyProcessed ? "already_confirmed" : "confirmed",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://audit/job_seeker/${result.jobSeekerId}`],
          nextActions: ["job_order_referral.confirmで求人への紹介行を作成してください"],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "job_seeker.confirmに失敗しました / job_seeker.confirm failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "求職者の確定に失敗しました / Failed to confirm the job seeker",
          "入力内容を確認し、再度お試しください。問題が続く場合はシステム管理者にご連絡ください。",
        );
      }
    },
  );
}

/**
 * dispatch_assignment.confirm：検証済み事実からdispatch_assignments確定＋派遣元管理台帳（A4）へ同時posting（write系。idempotency_key/reason必須）
 * dispatch_assignment.confirm: finalizes dispatch_assignments from verified facts and simultaneously posts to the dispatching-agency ledger (A4) (write tool; requires idempotency_key/reason)
 * dispatch_assignment.confirm: finalisasi dispatch_assignments dari fakta terverifikasi dan sekaligus posting ke buku besar agen dispatch (A4) (tool write; memerlukan idempotency_key/reason)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { confirmDispatchAssignment } from "../services/documents/confirm-dispatch-assignment.js";
import { dispatchConditionsInputSchema } from "../domain/dispatch-conditions.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const workerSnapshotSchema = z.object({
  staffId: z.string().min(1).describe("スタッフID / Staff id / ID staf"),
  name: z.string().min(1).describe("氏名 / Name / Nama"),
  address: z.string().min(1).describe("住所 / Address / Alamat"),
  nationality: z.string().optional().describe("国籍 / Nationality / Kewarganegaraan"),
});

const clientSnapshotSchema = z.object({
  companyId: z.string().min(1).describe("派遣先企業ID / Client company id / ID perusahaan klien"),
  name: z.string().min(1).describe("派遣先名称 / Client name / Nama klien"),
  address: z.string().min(1).describe("派遣先所在地 / Client address / Alamat klien"),
  representative: z.string().optional().describe("代表者 / Representative / Perwakilan"),
  contactPerson: z.string().optional().describe("担当者 / Contact person / Kontak person"),
});

const assignmentFieldsSchema = z.object({
  t2pFlag: z.boolean().describe("紹介予定派遣か / Is this T2P / Apakah ini T2P"),
  startDate: z.string().describe("派遣開始日(YYYY-MM-DD) / Dispatch start date / Tanggal mulai dispatch"),
  endDate: z.string().optional().describe("派遣終了日(YYYY-MM-DD) / Dispatch end date / Tanggal akhir dispatch"),
  orgUnit: z.string().optional().describe("組織単位（3年期間制限の単位） / Org unit (3-year limit unit) / Unit organisasi (batas 3 tahun)"),
  teishokubi: z.string().optional().describe("派遣可能期間の制限に抵触する日(YYYY-MM-DD) / 3-year-limit date / Tanggal batas 3 tahun"),
  conditionsTyped: dispatchConditionsInputSchema.describe(
    "labor_conditions_notice/A2/A3/A10が共有する派遣条件項目。生成予定のdocTypeに必要な項目を含めること / Dispatch-condition items shared by labor_conditions_notice/A2/A3/A10. Include the fields required by the docTypes you plan to generate / Item ketentuan dispatch yang dibagikan labor_conditions_notice/A2/A3/A10. Sertakan field yang diperlukan docType yang akan dihasilkan",
  ),
});

const ledgerEntryFieldsSchema = z.object({
  kyoteiTaisho: z.boolean().describe("協定対象派遣労働者か / Agreement-based worker / Pekerja berbasis perjanjian"),
  mukikoyo: z.boolean().describe("無期雇用派遣労働者か / Indefinite-employment worker / Pekerja dengan kepegawaian tanpa batas waktu"),
  contractPeriod: z.string().optional().describe("雇用契約期間 / Employment contract period / Periode kontrak kerja"),
  over60: z.boolean().optional().describe("60歳以上か / Age 60 or over / Usia 60 tahun atau lebih"),
  clientOffice: z.string().optional().describe("派遣先事業所 / Client office / Kantor klien"),
  clientAddress: z.string().optional().describe("派遣先所在地 / Client address / Alamat klien"),
  dispatchPeriod: z.string().optional().describe("派遣期間 / Dispatch period / Periode dispatch"),
  workDays: z.string().optional().describe("就業日 / Work days / Hari kerja"),
  workHoursStart: z.string().optional().describe("始業時刻 / Start time / Jam mulai"),
  workHoursEnd: z.string().optional().describe("終業時刻 / End time / Jam selesai"),
  workDetail: z.string().min(1).describe("業務の内容（派遣元管理台帳の必須項目） / Work detail (required item in the dispatching-agency ledger) / Detail pekerjaan (item wajib buku besar agen dispatch)"),
  responsibilityLevel: z.string().optional().describe("責任の程度 / Responsibility level / Tingkat tanggung jawab"),
  t2pMatters: z.string().optional().describe("紹介予定派遣に関する事項 / T2P-related matters / Hal terkait T2P"),
  hakenmotoSekininsha: z.string().optional().describe("派遣元責任者 / Agency-side responsible person / Penanggung jawab pihak agen"),
  hakensakiSekininsha: z.string().optional().describe("派遣先責任者 / Client-side responsible person / Penanggung jawab pihak klien"),
  overtimeTerms: z.string().optional().describe("時間外労働の範囲 / Overtime terms / Ketentuan lembur"),
  socialInsurance: z
    .record(z.string(), z.unknown())
    .describe("社会保険・労働保険の加入状況（派遣元管理台帳の必須項目） / Insurance enrollment status (required item in the dispatching-agency ledger) / Status kepesertaan asuransi (item wajib buku besar agen dispatch)"),
  kyoikuKunren: z.record(z.string(), z.unknown()).optional().describe("教育訓練の実施状況 / Training records / Catatan pelatihan"),
  careerConsulting: z.record(z.string(), z.unknown()).optional().describe("キャリアコンサルティングの実施状況 / Career consulting records / Catatan konsultasi karier"),
  koyouAnteiSochi: z.record(z.string(), z.unknown()).optional().describe("雇用安定措置の実施状況 / Employment-stability measures / Tindakan stabilitas kepegawaian"),
  complaints: z.record(z.string(), z.unknown()).optional().describe("苦情の申出・処理状況 / Complaint records / Catatan keluhan"),
  actualVsPlan: z.record(z.string(), z.unknown()).optional().describe("派遣就業実績と計画の比較 / Actual-vs-planned dispatch record / Catatan aktual vs rencana dispatch"),
});

const inputSchema = {
  idempotencyKey: z.string().min(1).describe("冪等キー。同一操作の再実行で副作用を1回に保つ / Idempotency key / Kunci idempotensi"),
  reason: z.string().min(1).describe("確定理由 / Reason for confirmation / Alasan konfirmasi"),
  sourceArtifactId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "抽出元の原文証跡ID（任意。dispatch_assignment.analyzeは未実装のため省略可） / Source-artifact evidence id (optional; dispatch_assignment.analyze does not exist yet) / ID bukti source-artifact (opsional; dispatch_assignment.analyze belum ada)",
    ),
  worker: workerSnapshotSchema,
  client: clientSnapshotSchema,
  assignment: assignmentFieldsSchema,
  ledgerEntry: ledgerEntryFieldsSchema,
};

export function registerDispatchAssignmentConfirm(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "dispatch_assignment.confirm",
    {
      title: "派遣就業を確定し派遣元管理台帳へ記帳する",
      description:
        "人間が検証済みの事実からdispatch_assignmentsを確定し、派遣元管理台帳（A4・帳簿37条）へ同時postingする。confirmed_byは認証主体から導出する。確定後はdocument.generate_draft（docType=A2/A3/A10/labor_conditions_notice）で各書類を生成できる。 / Finalizes dispatch_assignments from human-verified facts and simultaneously posts to the dispatching-agency ledger (A4, Art. 37). confirmed_by is derived from the authenticated principal. Once confirmed, document.generate_draft (docType=A2/A3/A10/labor_conditions_notice) can generate each document. / Finalisasi dispatch_assignments dari fakta yang diverifikasi manusia dan sekaligus posting ke buku besar agen dispatch (A4, Pasal 37). confirmed_by diturunkan dari principal terautentikasi. Setelah dikonfirmasi, document.generate_draft (docType=A2/A3/A10/labor_conditions_notice) dapat menghasilkan setiap dokumen.",
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

        const result = await confirmDispatchAssignment(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          idempotencyKey: args.idempotencyKey,
          reason: args.reason,
          sourceArtifactId: args.sourceArtifactId,
          worker: args.worker,
          client: args.client,
          assignment: args.assignment,
          ledgerEntry: args.ledgerEntry,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.dispatchAssignmentId,
          subjectVersion: 1,
          status: result.alreadyProcessed ? "already_confirmed" : "confirmed",
          missingFields: [],
          findings: [],
          evidenceRefs: [
            `assen://audit/dispatch_assignment/${result.dispatchAssignmentId}`,
            `assen://audit/dispatch_ledger_entry/${result.dispatchLedgerEntryId}`,
          ],
          nextActions: [
            "compliance.evaluateで各docType（A2/A3/A10/labor_conditions_notice）の法定必須項目の充足状況を確認してください",
            "document.previewでdocTypeごとの生成前プレビューを確認してください",
          ],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "dispatch_assignment.confirmに失敗しました / dispatch_assignment.confirm failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult(
          "派遣就業の確定に失敗しました / Failed to confirm the dispatch assignment",
          "入力内容を確認し、再度お試しください。問題が続く場合はシステム管理者にご連絡ください。",
        );
      }
    },
  );
}

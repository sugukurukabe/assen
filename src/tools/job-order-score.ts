/**
 * job_order.score：「決めやすい案件」スコアリング（§04）
 * job_order.score: ease-of-close job scoring (§04)
 * job_order.score: penilaian skor order yang mudah ditutup (§04)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { scoreAndPersistJobOrder } from "../services/job-orders/score-job-order.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { logMessage } from "../lib/logger.js";
import { UserInputError } from "../lib/errors.js";

const inputSchema = {
  jobOrderId: z.string().uuid().describe("採点対象の求人ID / Job order id to score / ID lowongan yang dinilai"),
  zcareerJobId: z.string().optional().describe("Zキャリア求人ID / Z-Career job id / ID lowongan Z-Career"),
  offerRatePercent: z.number().min(0).max(100).optional().describe("内定率(%) / Offer rate (%) / Tingkat penerimaan (%)"),
  documentPassRatePercent: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("書類通過率(%) / Document pass rate (%) / Tingkat lolos berkas (%)"),
  recentApplicantCount: z.number().int().min(0).optional().describe("直近応募数 / Recent applicant count / Jumlah pelamar terbaru"),
  foreignNationalsOk: z.boolean().optional().describe("外国籍可 / Foreign nationals OK / WNA diperbolehkan"),
  inexperiencedOk: z.boolean().optional().describe("未経験可 / Inexperienced OK / Tanpa pengalaman OK"),
  requiresNativeJapanese: z.boolean().optional().describe("日本語ネイティブ要求 / Requires native Japanese / Wajib bahasa Jepang native"),
  hasDormitory: z.boolean().optional().describe("社員寮あり / Has dormitory / Ada asrama"),
  hasRelocationAllowance: z.boolean().optional().describe("引越し手当あり / Has relocation allowance / Ada tunjangan pindah"),
  kyushuLocation: z.boolean().optional().describe("九州勤務地あり / Kyushu work location / Lokasi kerja Kyushu"),
  laneFit: z
    .enum(["hotel", "restaurant", "mobile_shop", "ja_office", "none"])
    .optional()
    .describe("§03の4レーン適合（ホテル/外食/携帯ショップ/JA事務員/なし） / Fit to the four §03 lanes / Kecocokan dengan 4 jalur"),
  wantsExperiencedWorker: z.boolean().optional().describe("社会人経験者を求める求人か / Whether the job prefers experienced workers / Apakah mencari pekerja berpengalaman"),
  isConstructionSupervisorLane: z
    .boolean()
    .optional()
    .describe("建設監督レーンか（B/CでもP2送り例外） / Construction supervisor lane (B/C → P2 exception) / Jalur pengawas konstruksi (pengecualian B/C → P2)"),
};

export function registerJobOrderScore(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "job_order_score",
    {
      title: "決めやすい案件スコアを付ける",
      description:
        "Zキャリア/Ex-ord/直入の内定率・書類通過率・応募数・候補者適合・生活条件・§03レーン適合からS(9+)/A(6–8)/B/Cを算出して求人に保存する。建設監督系のB/CはP2レーン送りフラグを返す。 / Computes S(9+)/A(6–8)/B/C from offer rate, document pass rate, applicant count, pool fit, living conditions, and §03 lane fit. / Menghitung S(9+)/A(6–8)/B/C dari tingkat penerimaan, lolos berkas, jumlah pelamar, kecocokan pool, kondisi hidup, dan kecocokan jalur §03.",
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
        const result = await scoreAndPersistJobOrder(context.db, {
          jobOrderId: args.jobOrderId,
          zcareerJobId: args.zcareerJobId,
          scoreInput: {
            offerRatePercent: args.offerRatePercent,
            documentPassRatePercent: args.documentPassRatePercent,
            recentApplicantCount: args.recentApplicantCount,
            foreignNationalsOk: args.foreignNationalsOk,
            inexperiencedOk: args.inexperiencedOk,
            requiresNativeJapanese: args.requiresNativeJapanese,
            hasDormitory: args.hasDormitory,
            hasRelocationAllowance: args.hasRelocationAllowance,
            kyushuLocation: args.kyushuLocation,
            laneFit: args.laneFit,
            wantsExperiencedWorker: args.wantsExperiencedWorker,
            isConstructionSupervisorLane: args.isConstructionSupervisorLane,
          },
        });
        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.jobOrderId,
          subjectVersion: 1,
          status: "scored",
          grade: result.grade,
          total: result.total,
          breakdown: result.breakdown,
          routeToP2Lane: result.routeToP2Lane,
          recommendation: result.recommendation,
          missingFields: [],
          findings: [],
          evidenceRefs: [],
          nextActions:
            result.grade === "S" || result.grade === "A"
              ? ["job_order.listでS/Aリストを確認し、候補者と突合してください / Review the S/A list via job_order.list and match candidates"]
              : result.routeToP2Lane
                ? ["P2レーン（壁・吉原判断）へ回してください / Route to the P2 lane (Kabe/Yoshihara)"]
                : ["追わずリストにも入れないでください / Do not chase; do not add to the list"],
        });
      } catch (error) {
        if (error instanceof UserInputError) {
          return toToolErrorResult(error.message, error.remediation);
        }
        logMessage("error", "job_order.scoreに失敗しました / job_order.score failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("求人スコアリングに失敗しました / Failed to score the job order", "入力を確認して再実行してください。");
      }
    },
  );
}

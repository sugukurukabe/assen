/**
 * 「決めやすい案件」スコアリング（紹介ローンチ設計書§04）
 * Ease-of-close job scoring (Placement Launch Spec §04)
 * Penilaian skor "order yang mudah ditutup" (Spesifikasi Peluncuran §04)
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobOrders } from "../../db/schema/ledgers.js";
import { UserInputError } from "../../lib/errors.js";

type Db = NodePgDatabase<typeof schema>;

export type ScoreGrade = "S" | "A" | "B" | "C";

export interface JobOrderScoreInput {
  offerRatePercent?: number;
  documentPassRatePercent?: number;
  recentApplicantCount?: number;
  foreignNationalsOk?: boolean;
  inexperiencedOk?: boolean;
  requiresNativeJapanese?: boolean;
  hasDormitory?: boolean;
  hasRelocationAllowance?: boolean;
  kyushuLocation?: boolean;
  isConstructionSupervisorLane?: boolean;
}

export interface ScoreBreakdown {
  offerRate: number;
  documentPassRate: number;
  competition: number;
  candidatePoolFit: number;
  livingConditions: number;
}

export interface JobOrderScoreResult {
  total: number;
  grade: ScoreGrade;
  breakdown: ScoreBreakdown;
  // 建設監督系のB/CはP2レーンへ送る例外 / Construction-supervisor B/C exception → P2 lane / Pengecualian B/C pengawas konstruksi → jalur P2
  routeToP2Lane: boolean;
  recommendation: string;
}

/**
 * Zキャリア画面の数値からS/A/B/Cを算出する（感覚ではなく点数）
 * Computes S/A/B/C from Z-Career screen numbers (scores, not gut feel)
 * Menghitung S/A/B/C dari angka layar Z-Career (skor, bukan perasaan)
 */
export function computeJobOrderScore(input: JobOrderScoreInput): JobOrderScoreResult {
  let offerRate = 0;
  if (input.offerRatePercent !== undefined) {
    if (input.offerRatePercent >= 5 && input.offerRatePercent <= 10) {
      offerRate = 3;
    } else if (input.offerRatePercent >= 3 && input.offerRatePercent < 5) {
      offerRate = 2;
    }
  }

  let documentPassRate = 0;
  if (input.documentPassRatePercent !== undefined) {
    if (input.documentPassRatePercent >= 50) {
      documentPassRate = 3;
    } else if (input.documentPassRatePercent >= 25) {
      documentPassRate = 1;
    }
  }

  let competition = 0;
  if (input.recentApplicantCount !== undefined) {
    if (input.recentApplicantCount >= 5 && input.recentApplicantCount <= 10) {
      competition = 2;
    } else if (input.recentApplicantCount >= 15) {
      competition = 0;
    }
  }

  let candidatePoolFit = 0;
  if (input.foreignNationalsOk) {
    candidatePoolFit += 2;
  }
  if (input.inexperiencedOk) {
    candidatePoolFit += 1;
  }
  if (input.requiresNativeJapanese) {
    candidatePoolFit -= 2;
  }

  let livingConditions = 0;
  if (input.hasDormitory) {
    livingConditions += 1;
  }
  if (input.hasRelocationAllowance) {
    livingConditions += 1;
  }
  if (input.kyushuLocation) {
    livingConditions += 1;
  }

  const breakdown: ScoreBreakdown = {
    offerRate,
    documentPassRate,
    competition,
    candidatePoolFit,
    livingConditions,
  };
  const total = offerRate + documentPassRate + competition + candidatePoolFit + livingConditions;

  let grade: ScoreGrade;
  if (total >= 8) {
    grade = "S";
  } else if (total >= 5) {
    grade = "A";
  } else if (total >= 3) {
    grade = "B";
  } else {
    grade = "C";
  }

  const routeToP2Lane = Boolean(input.isConstructionSupervisorLane) && (grade === "B" || grade === "C");

  let recommendation: string;
  if (grade === "S") {
    recommendation = "今週の推薦対象。候補者リストと即突合 / Recommend this week; match against candidates immediately";
  } else if (grade === "A") {
    recommendation = "ターゲットリスト維持（常時10件）。合う候補者が登録されたら即提案 / Keep on target list (always 10); propose when a fit registers";
  } else if (routeToP2Lane) {
    recommendation = "建設監督系例外＝P2レーンで壁・吉原判断へ / Construction-supervisor exception → P2 lane for Kabe/Yoshihara";
  } else {
    recommendation = "追わない。リストにも入れない / Do not chase; do not add to the list";
  }

  return { total, grade, breakdown, routeToP2Lane, recommendation };
}

export interface PersistJobOrderScoreInput {
  jobOrderId: string;
  zcareerJobId?: string;
  scoreInput: JobOrderScoreInput;
}

export async function scoreAndPersistJobOrder(
  db: Db,
  input: PersistJobOrderScoreInput,
): Promise<JobOrderScoreResult & { jobOrderId: string }> {
  const [existing] = await db.select().from(jobOrders).where(eq(jobOrders.id, input.jobOrderId)).limit(1);
  if (!existing) {
    throw new UserInputError(
      `job_order ${input.jobOrderId} が見つかりません / job_order ${input.jobOrderId} not found`,
      "jobOrderIdを確認してください / Please verify jobOrderId",
    );
  }

  const scored = computeJobOrderScore(input.scoreInput);
  await db
    .update(jobOrders)
    .set({
      zcareerJobId: input.zcareerJobId ?? existing.zcareerJobId,
      scoreGrade: scored.grade,
      scoreTotal: scored.total,
      scoreBreakdown: scored.breakdown,
      updatedAt: new Date(),
    })
    .where(eq(jobOrders.id, input.jobOrderId));

  return { jobOrderId: input.jobOrderId, ...scored };
}

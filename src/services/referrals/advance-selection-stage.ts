/**
 * 選考段階を進める（登録→書類選考→面接→内定→成約）。KPIファネル計測の基盤
 * Advances selection stage (registered→screening→interview→offer→placed). Basis for KPI funnel metrics
 * Memajukan tahap seleksi. Dasar metrik funnel KPI
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobOrderReferrals } from "../../db/schema/ledgers.js";
import { UserInputError } from "../../lib/errors.js";

type Db = NodePgDatabase<typeof schema>;

export type SelectionStage = "registered" | "screening" | "interview" | "offer" | "placed";

const STAGE_ORDER: SelectionStage[] = ["registered", "screening", "interview", "offer", "placed"];

export interface AdvanceSelectionStageInput {
  jobOrderReferralId: string;
  selectionStage: SelectionStage;
  stageDate: string;
}

export async function advanceSelectionStage(db: Db, input: AdvanceSelectionStageInput) {
  const [referral] = await db
    .select()
    .from(jobOrderReferrals)
    .where(eq(jobOrderReferrals.id, input.jobOrderReferralId))
    .limit(1);
  if (!referral) {
    throw new UserInputError(
      `job_order_referral ${input.jobOrderReferralId} が見つかりません / job_order_referral ${input.jobOrderReferralId} not found`,
      "jobOrderReferralIdを確認してください / Please verify jobOrderReferralId",
    );
  }

  if (referral.outcome === "hired" || referral.selectionStage === "placed") {
    throw new UserInputError(
      "成約済みの紹介行はplacement.confirm以外で段階を変えられません / Placed referrals can only be changed via placement.confirm",
      "成約の確定はplacement.confirmを使ってください / Use placement.confirm to finalize placement",
    );
  }

  const currentIndex = STAGE_ORDER.indexOf(referral.selectionStage);
  const nextIndex = STAGE_ORDER.indexOf(input.selectionStage);
  if (nextIndex < currentIndex) {
    throw new UserInputError(
      `選考段階を逆戻りできません（現在: ${referral.selectionStage}） / Cannot move selection stage backwards (current: ${referral.selectionStage})`,
      "前の段階へ戻す必要がある場合は管理者に連絡してください / Contact an admin if a rollback is required",
    );
  }

  const patch: Record<string, unknown> = {
    selectionStage: input.selectionStage,
    updatedAt: new Date(),
  };
  if (input.selectionStage === "registered") {
    patch.registeredAt = input.stageDate;
  }
  if (input.selectionStage === "screening") {
    patch.screeningAt = input.stageDate;
  }
  if (input.selectionStage === "interview") {
    patch.interviewAt = input.stageDate;
  }
  if (input.selectionStage === "offer") {
    patch.offerAt = input.stageDate;
  }
  if (input.selectionStage === "placed") {
    throw new UserInputError(
      "placed段階はplacement.confirmでのみ設定できます / The placed stage is set only via placement.confirm",
      "成約時はplacement.confirmを呼び出してください / Call placement.confirm on hire",
    );
  }

  await db.update(jobOrderReferrals).set(patch).where(eq(jobOrderReferrals.id, input.jobOrderReferralId));

  return {
    jobOrderReferralId: input.jobOrderReferralId,
    selectionStage: input.selectionStage,
    stageDate: input.stageDate,
  };
}

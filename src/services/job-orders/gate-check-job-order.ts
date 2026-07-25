/**
 * job_order.gate-checkの中核：G1監督職判定を実行し求人行へ保存する
 * Core of job_order.gate-check: runs G1 supervisor assessment and persists it on the job order
 * Inti job_order.gate-check: menjalankan penilaian pengawas G1 dan menyimpannya pada lowongan
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobOrders } from "../../db/schema/ledgers.js";
import { UserInputError } from "../../lib/errors.js";
import {
  assessSupervisorGate,
  checkAccurateRepresentation,
  type SupervisorAssessmentResult,
} from "../rules/esa-gates.js";

type Db = NodePgDatabase<typeof schema>;

export interface GateCheckJobOrderInput {
  jobOrderId: string;
  jobTitle?: string;
  actualDuties: string;
  adCopy?: string;
}

export interface GateCheckJobOrderResult extends SupervisorAssessmentResult {
  jobOrderId: string;
  g6Findings: ReturnType<typeof checkAccurateRepresentation>;
}

export async function gateCheckJobOrder(db: Db, input: GateCheckJobOrderInput): Promise<GateCheckJobOrderResult> {
  const [existing] = await db.select().from(jobOrders).where(eq(jobOrders.id, input.jobOrderId)).limit(1);
  if (!existing) {
    throw new UserInputError(
      `job_order ${input.jobOrderId} が見つかりません / job_order ${input.jobOrderId} not found`,
      "jobOrderIdを確認してください / Please verify jobOrderId",
    );
  }

  const assessment = assessSupervisorGate({
    jobTitle: input.jobTitle ?? existing.jobTitle ?? undefined,
    actualDuties: input.actualDuties,
    occupation: existing.occupation,
  });

  const g6Findings = input.adCopy ? checkAccurateRepresentation(input.adCopy) : [];

  await db
    .update(jobOrders)
    .set({
      jobTitle: input.jobTitle ?? existing.jobTitle,
      actualDuties: input.actualDuties,
      supervisorGateResult: assessment.result,
      supervisorAssessment: {
        matchedKeywords: assessment.matchedKeywords,
        rationale: assessment.rationale,
        assessedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(jobOrders.id, input.jobOrderId));

  return { jobOrderId: input.jobOrderId, ...assessment, g6Findings };
}

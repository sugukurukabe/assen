/**
 * job_order.confirmの中核処理：検証済み事実からjob_orders確定＋帳簿①posting（§7・§4.2）
 * Core logic for job_order.confirm: finalizes job_orders from verified facts and posts Ledger #1 (§7, §4.2)
 * Logika inti job_order.confirm: finalisasi job_orders dari fakta terverifikasi dan posting Buku Besar #1 (§7, §4.2)
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { jobOrders } from "../../db/schema/ledgers.js";
import { factAssertions } from "../../db/schema/evidence.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { createPartySnapshot } from "./party-snapshot.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { enqueueOutboxEvent } from "../outbox-worker/enqueue.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface EmployerSnapshotInput {
  companyId: string;
  name: string;
  address: string;
  representative: string;
  contactPerson: string;
}

export interface ConfirmJobOrderFields {
  acceptedAt: string;
  validUntil: string;
  headcount: number;
  occupation: string;
  workLocation: string;
  employmentPeriodType: "indefinite" | "fixed";
  employmentPeriodDetail?: string;
  wageAmountMin?: number;
  wageAmountMax?: number;
  wageUnit: "hour" | "day" | "month" | "year";
  t2pFlag: boolean;
  refundSystem: boolean;
  source: "zcareer" | "exord" | "direct" | "sns";
}

export interface ConfirmJobOrderInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  idempotencyKey: string;
  reason: string;
  sourceArtifactId: string;
  employer: EmployerSnapshotInput;
  fields: ConfirmJobOrderFields;
}

export interface ConfirmJobOrderResult {
  jobOrderId: string;
  alreadyProcessed: boolean;
}

export async function confirmJobOrder(db: Db, input: ConfirmJobOrderInput): Promise<ConfirmJobOrderResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing?.externalReference) {
      return { jobOrderId: existing.externalReference, alreadyProcessed: true };
    }

    const { id: employerSnapshotId } = await createPartySnapshot(tx, {
      tenantId: input.tenantId,
      partyType: "company",
      partyRefId: input.employer.companyId,
      snapshot: { ...input.employer },
      takenReason: "job_order_accept",
    });

    const jobOrderId = randomUUID();
    await tx.insert(jobOrders).values({
      id: jobOrderId,
      tenantId: input.tenantId,
      companyId: input.employer.companyId,
      employerSnapshotId,
      acceptedAt: input.fields.acceptedAt,
      validUntil: input.fields.validUntil,
      headcount: input.fields.headcount,
      occupation: input.fields.occupation,
      workLocation: input.fields.workLocation,
      employmentPeriodType: input.fields.employmentPeriodType,
      employmentPeriodDetail: input.fields.employmentPeriodDetail,
      wageAmountMin: input.fields.wageAmountMin?.toString(),
      wageAmountMax: input.fields.wageAmountMax?.toString(),
      wageUnit: input.fields.wageUnit,
      t2pFlag: input.fields.t2pFlag,
      refundSystem: input.fields.refundSystem,
      source: input.fields.source,
      sourceArtifactId: input.sourceArtifactId,
      status: "open",
    });

    // ③人間確認：この確定操作をもってfact_assertionsを検証済みにする（認証主体から導出） / Human verification: this confirm action marks fact_assertions verified (derived from the authenticated principal) / Verifikasi manusia: aksi confirm ini menandai fact_assertions terverifikasi (diturunkan dari principal terautentikasi)
    const confirmedFieldPaths = Object.keys(input.fields);
    if (confirmedFieldPaths.length > 0) {
      await tx
        .update(factAssertions)
        .set({ verificationStatus: "verified", verifiedBy: input.principal.principalId, verifiedAt: new Date() })
        .where(
          and(
            eq(factAssertions.subjectType, "job_order_draft"),
            eq(factAssertions.subjectId, input.sourceArtifactId),
            inArray(factAssertions.fieldPath, confirmedFieldPaths),
          ),
        );
    }

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_order",
      aggregateId: jobOrderId,
      aggregateVersion: 1,
      eventType: "job_order.confirmed",
      afterHash: sha256Hex(canonicalJsonString({ jobOrderId, fields: input.fields })),
      principal: input.principal,
      requestId: input.requestId,
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "job_order",
      aggregateId: jobOrderId,
      eventType: "job_order.confirmed",
      payload: { jobOrderId, reason: input.reason },
      idempotencyKey: input.idempotencyKey,
      externalReference: jobOrderId,
    });

    return { jobOrderId, alreadyProcessed: false };
  });
}

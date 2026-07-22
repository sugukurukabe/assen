/**
 * dispatch_assignment.confirmの中核処理：派遣就業（dispatch_assignments）を確定し、派遣元管理台帳
 * （A4・dispatch_ledger_entries）へ同時記帳する（§4.2・§7、confirm-job-order.tsと同型パターン）。
 * A2/A3/A10（doc-type-registry.ts）はすべてここで確定したdispatch_assignments行を主語（subject）にする
 *
 * Core logic for dispatch_assignment.confirm: finalizes dispatch_assignments and simultaneously posts to
 * the dispatching-agency ledger (A4 / dispatch_ledger_entries) (§4.2, §7; mirrors confirm-job-order.ts).
 * A2/A3/A10 (doc-type-registry.ts) all use the dispatch_assignments row confirmed here as their subject
 *
 * Logika inti dispatch_assignment.confirm: finalisasi dispatch_assignments dan sekaligus posting ke
 * buku besar agen dispatch (A4 / dispatch_ledger_entries) (§4.2, §7; mencerminkan confirm-job-order.ts).
 * A2/A3/A10 (doc-type-registry.ts) semuanya memakai baris dispatch_assignments yang dikonfirmasi di sini sebagai subject
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { dispatchAssignments, dispatchLedgerEntries } from "../../db/schema/ledgers.js";
import { factAssertions } from "../../db/schema/evidence.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { createPartySnapshot } from "./party-snapshot.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { enqueueOutboxEvent } from "../outbox-worker/enqueue.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface WorkerSnapshotInput {
  staffId: string;
  name: string;
  address: string;
  nationality?: string;
}

export interface ClientSnapshotInput {
  companyId: string;
  name: string;
  address: string;
  representative?: string;
  contactPerson?: string;
}

export interface DispatchAssignmentFields {
  t2pFlag: boolean;
  startDate: string;
  endDate?: string;
  orgUnit?: string;
  teishokubi?: string;
  // labor_conditions_notice/A2/A3/A10が共有するJSONB（src/domain/dispatch-conditions.ts参照）
  // JSONB shared by labor_conditions_notice/A2/A3/A10 (see src/domain/dispatch-conditions.ts)
  // JSONB yang dibagikan oleh labor_conditions_notice/A2/A3/A10 (lihat src/domain/dispatch-conditions.ts)
  conditionsTyped: Record<string, unknown>;
}

export interface DispatchLedgerEntryFields {
  kyoteiTaisho: boolean;
  mukikoyo: boolean;
  contractPeriod?: string;
  over60?: boolean;
  clientOffice?: string;
  clientAddress?: string;
  dispatchPeriod?: string;
  workDays?: string;
  workHoursStart?: string;
  workHoursEnd?: string;
  workDetail: string;
  responsibilityLevel?: string;
  t2pMatters?: string;
  hakenmotoSekininsha?: string;
  hakensakiSekininsha?: string;
  overtimeTerms?: string;
  socialInsurance: Record<string, unknown>;
  kyoikuKunren?: Record<string, unknown>;
  careerConsulting?: Record<string, unknown>;
  koyouAnteiSochi?: Record<string, unknown>;
  complaints?: Record<string, unknown>;
  actualVsPlan?: Record<string, unknown>;
}

export interface ConfirmDispatchAssignmentInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  idempotencyKey: string;
  reason: string;
  // 抽出元の原文証跡（任意）。指定時のみfact_assertionsを検証済みにする（dispatch_assignment.analyzeは未実装のため任意）
  // Optional source-artifact evidence. When provided, marks fact_assertions verified (optional because dispatch_assignment.analyze does not exist yet)
  // Bukti source-artifact opsional. Jika diberikan, menandai fact_assertions terverifikasi (opsional karena dispatch_assignment.analyze belum ada)
  sourceArtifactId?: string;
  worker: WorkerSnapshotInput;
  client: ClientSnapshotInput;
  assignment: DispatchAssignmentFields;
  ledgerEntry: DispatchLedgerEntryFields;
}

export interface ConfirmDispatchAssignmentResult {
  dispatchAssignmentId: string;
  dispatchLedgerEntryId: string;
  alreadyProcessed: boolean;
}

export async function confirmDispatchAssignment(
  db: Db,
  input: ConfirmDispatchAssignmentInput,
): Promise<ConfirmDispatchAssignmentResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing?.externalReference) {
      const [existingLedgerEntry] = await tx
        .select()
        .from(dispatchLedgerEntries)
        .where(eq(dispatchLedgerEntries.dispatchAssignmentId, existing.externalReference))
        .limit(1);
      if (!existingLedgerEntry) {
        throw new UserInputError(
          "冪等キーは処理済みですが台帳行が見つかりません（データ不整合） / Idempotency key already processed but the ledger row is missing (data inconsistency)",
          "システム管理者にご連絡ください / Please contact a system administrator",
        );
      }
      return { dispatchAssignmentId: existing.externalReference, dispatchLedgerEntryId: existingLedgerEntry.id, alreadyProcessed: true };
    }

    const { id: workerSnapshotId } = await createPartySnapshot(tx, {
      tenantId: input.tenantId,
      partyType: "worker",
      partyRefId: input.worker.staffId,
      snapshot: { ...input.worker },
      takenReason: "contract_approve",
    });

    const { id: clientSnapshotId } = await createPartySnapshot(tx, {
      tenantId: input.tenantId,
      partyType: "company",
      partyRefId: input.client.companyId,
      snapshot: { ...input.client },
      takenReason: "contract_approve",
    });

    const dispatchAssignmentId = randomUUID();
    await tx.insert(dispatchAssignments).values({
      id: dispatchAssignmentId,
      tenantId: input.tenantId,
      staffId: input.worker.staffId,
      companyId: input.client.companyId,
      t2pFlag: input.assignment.t2pFlag,
      startDate: input.assignment.startDate,
      endDate: input.assignment.endDate,
      orgUnit: input.assignment.orgUnit,
      teishokubi: input.assignment.teishokubi,
      conditionsTyped: input.assignment.conditionsTyped,
    });

    const dispatchLedgerEntryId = randomUUID();
    await tx.insert(dispatchLedgerEntries).values({
      id: dispatchLedgerEntryId,
      tenantId: input.tenantId,
      dispatchAssignmentId,
      staffId: input.worker.staffId,
      workerSnapshotId,
      clientSnapshotId,
      kyoteiTaisho: input.ledgerEntry.kyoteiTaisho,
      mukikoyo: input.ledgerEntry.mukikoyo,
      contractPeriod: input.ledgerEntry.contractPeriod,
      over60: input.ledgerEntry.over60 ?? false,
      clientOffice: input.ledgerEntry.clientOffice,
      clientAddress: input.ledgerEntry.clientAddress,
      orgUnit: input.assignment.orgUnit,
      dispatchPeriod: input.ledgerEntry.dispatchPeriod,
      workDays: input.ledgerEntry.workDays,
      workHoursStart: input.ledgerEntry.workHoursStart,
      workHoursEnd: input.ledgerEntry.workHoursEnd,
      workDetail: input.ledgerEntry.workDetail,
      responsibilityLevel: input.ledgerEntry.responsibilityLevel,
      t2pFlag: input.assignment.t2pFlag,
      t2pMatters: input.ledgerEntry.t2pMatters,
      hakenmotoSekininsha: input.ledgerEntry.hakenmotoSekininsha,
      hakensakiSekininsha: input.ledgerEntry.hakensakiSekininsha,
      overtimeTerms: input.ledgerEntry.overtimeTerms,
      socialInsurance: input.ledgerEntry.socialInsurance,
      kyoikuKunren: input.ledgerEntry.kyoikuKunren,
      careerConsulting: input.ledgerEntry.careerConsulting,
      koyouAnteiSochi: input.ledgerEntry.koyouAnteiSochi,
      complaints: input.ledgerEntry.complaints,
      actualVsPlan: input.ledgerEntry.actualVsPlan,
    });

    // ③人間確認：この確定操作をもってfact_assertionsを検証済みにする（sourceArtifactId指定時のみ） / Human verification: marks fact_assertions verified when sourceArtifactId is provided / Verifikasi manusia: menandai fact_assertions terverifikasi hanya jika sourceArtifactId diberikan
    if (input.sourceArtifactId) {
      const confirmedFieldPaths = Object.keys(input.assignment.conditionsTyped);
      if (confirmedFieldPaths.length > 0) {
        await tx
          .update(factAssertions)
          .set({ verificationStatus: "verified", verifiedBy: input.principal.principalId, verifiedAt: new Date() })
          .where(
            and(
              eq(factAssertions.subjectType, "dispatch_assignment_draft"),
              eq(factAssertions.subjectId, input.sourceArtifactId),
              inArray(factAssertions.fieldPath, confirmedFieldPaths),
            ),
          );
      }
    }

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "dispatch_assignment",
      aggregateId: dispatchAssignmentId,
      aggregateVersion: 1,
      eventType: "dispatch_assignment.confirmed",
      afterHash: sha256Hex(canonicalJsonString({ dispatchAssignmentId, assignment: input.assignment, ledgerEntry: input.ledgerEntry })),
      principal: input.principal,
      requestId: input.requestId,
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "dispatch_assignment",
      aggregateId: dispatchAssignmentId,
      eventType: "dispatch_assignment.confirmed",
      payload: { dispatchAssignmentId, dispatchLedgerEntryId, reason: input.reason },
      idempotencyKey: input.idempotencyKey,
      externalReference: dispatchAssignmentId,
    });

    return { dispatchAssignmentId, dispatchLedgerEntryId, alreadyProcessed: false };
  });
}

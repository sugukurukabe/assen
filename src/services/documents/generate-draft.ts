/**
 * document.generate_draftの中核処理：dispatch_assignments.conditionsTypedからテンプレートを差し込み、
 * GCS/MinIOへcontent-addressableに保存し、documentsをdraftとして作成する（§7・§6ステップ⑤）
 * Core logic for document.generate_draft: renders the template from dispatch_assignments.conditionsTyped,
 * stores it content-addressably, and creates a documents row as draft (§7, §6 step 5)
 * Logika inti document.generate_draft: merender template dari dispatch_assignments.conditionsTyped,
 * menyimpannya secara content-addressable, dan membuat baris documents sebagai draft (§7, langkah 5 §6)
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { dispatchAssignments } from "../../db/schema/ledgers.js";
import { documents } from "../../db/schema/documents.js";
import { transactionalOutbox } from "../../db/schema/outbox.js";
import { renderTemplate } from "./render-template.js";
import { putImmutableObject } from "../../lib/storage.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import { UserInputError } from "../../lib/errors.js";
import { laborConditionsNoticeSchema } from "../../domain/labor-conditions-notice.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { enqueueOutboxEvent } from "../outbox-worker/enqueue.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

const TEMPLATE_VERSION = "labor-conditions-notice.v1";
const RULE_SET_VERSION = "v1";

export interface GenerateDraftInput {
  tenantId: string;
  dispatchAssignmentId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  // 同一操作の再実行でdraftが重複作成されないようにするための冪等キー / Idempotency key preventing duplicate drafts on retry / Kunci idempotensi agar draft tidak duplikat saat retry
  idempotencyKey: string;
  reason: string;
}

export interface GenerateDraftResult {
  documentId: string;
  logicalDocumentId: string;
  version: number;
  generatedSha256: string;
  generatedObjectUri: string;
}

export async function generateLaborConditionsNoticeDraft(db: Db, input: GenerateDraftInput): Promise<GenerateDraftResult> {
  // 冪等キーが既に処理済みなら、レンダリング・アップロードを行わず既存documentをそのまま返す
  // If the idempotency key was already processed, skip rendering/upload and return the existing document
  // Jika kunci idempotensi sudah diproses, lewati rendering/upload dan kembalikan document yang sudah ada
  const [existingOutboxEntry] = await db
    .select()
    .from(transactionalOutbox)
    .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingOutboxEntry?.externalReference) {
    const [existingDocument] = await db.select().from(documents).where(eq(documents.id, existingOutboxEntry.externalReference));
    if (existingDocument?.generatedObjectUri && existingDocument.generatedSha256) {
      return {
        documentId: existingDocument.id,
        logicalDocumentId: existingDocument.logicalDocumentId,
        version: existingDocument.version,
        generatedSha256: existingDocument.generatedSha256,
        generatedObjectUri: existingDocument.generatedObjectUri,
      };
    }
  }

  const [assignment] = await db.select().from(dispatchAssignments).where(eq(dispatchAssignments.id, input.dispatchAssignmentId));
  if (!assignment) {
    throw new UserInputError(
      `dispatch_assignment ${input.dispatchAssignmentId} が見つかりません / dispatch_assignment ${input.dispatchAssignmentId} not found`,
      "dispatchAssignmentIdを確認してください / Please verify dispatchAssignmentId",
    );
  }

  const parsed = laborConditionsNoticeSchema.safeParse(assignment.conditionsTyped);
  const values = parsed.success ? parsed.data : (assignment.conditionsTyped as Record<string, unknown>);

  const bytes = renderTemplate(`${TEMPLATE_VERSION}.txt`, values);
  const { objectUri, sha256 } = await putImmutableObject("documents/labor-conditions-notice", bytes, "text/plain; charset=utf-8");

  const documentId = randomUUID();
  const logicalDocumentId = randomUUID();
  const inputSnapshotHash = sha256Hex(canonicalJsonString(values));

  await db.transaction(async (tx) => {
    await tx.insert(documents).values({
      id: documentId,
      tenantId: input.tenantId,
      logicalDocumentId,
      version: 1,
      docType: "labor_conditions_notice",
      subjectType: "dispatch_assignment",
      subjectId: input.dispatchAssignmentId,
      templateVersion: TEMPLATE_VERSION,
      ruleSetVersion: RULE_SET_VERSION,
      inputSnapshotHash,
      generatedObjectUri: objectUri,
      generatedSha256: sha256,
      contentStatus: "draft",
    });

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: documentId,
      aggregateVersion: 1,
      eventType: "document.draft_generated",
      afterHash: sha256,
      principal: input.principal,
      requestId: input.requestId,
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: documentId,
      eventType: "document.draft_generated",
      payload: { documentId, dispatchAssignmentId: input.dispatchAssignmentId, reason: input.reason },
      idempotencyKey: input.idempotencyKey,
      externalReference: documentId,
    });
  });

  return { documentId, logicalDocumentId, version: 1, generatedSha256: sha256, generatedObjectUri: objectUri };
}

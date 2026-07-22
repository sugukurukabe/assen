/**
 * document.supersedeの中核処理：訂正版発行。理由必須。旧版はsuperseded、新版はdraftとして作成する
 * Core logic for document.supersede: issues a corrected version. Reason is mandatory; the old version becomes
 * superseded and the new version starts as draft
 * Logika inti document.supersede: menerbitkan versi yang dikoreksi. Alasan wajib; versi lama menjadi
 * superseded dan versi baru dimulai sebagai draft
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { documents } from "../../db/schema/documents.js";
import { assertContentTransition } from "./state-machine.js";
import { renderTemplate } from "./render-template.js";
import { putImmutableObject } from "../../lib/storage.js";
import { canonicalJsonString, sha256Hex } from "../../lib/hash.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface SupersedeDocumentInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  documentId: string;
  reason: string;
  correctedValues: Record<string, unknown>;
}

export interface SupersedeDocumentResult {
  newDocumentId: string;
  newVersion: number;
}

export async function supersedeDocument(db: Db, input: SupersedeDocumentInput): Promise<SupersedeDocumentResult> {
  if (!input.reason.trim()) {
    throw new UserInputError("訂正理由は必須です / A correction reason is required", "reasonを指定してください / Please provide a reason");
  }

  return db.transaction(async (tx) => {
    const [oldDocument] = await tx.select().from(documents).where(eq(documents.id, input.documentId));
    if (!oldDocument) {
      throw new UserInputError(
        `document ${input.documentId} が見つかりません / document ${input.documentId} not found`,
        "documentIdを確認してください / Please verify documentId",
      );
    }

    assertContentTransition(oldDocument.contentStatus, "superseded");

    const bytes = renderTemplate(`${oldDocument.templateVersion}.txt`, input.correctedValues);
    const { objectUri, sha256 } = await putImmutableObject("documents/labor-conditions-notice", bytes, "text/plain; charset=utf-8");

    const newDocumentId = randomUUID();
    const newVersion = oldDocument.version + 1;

    await tx.insert(documents).values({
      id: newDocumentId,
      tenantId: input.tenantId,
      logicalDocumentId: oldDocument.logicalDocumentId,
      version: newVersion,
      docType: oldDocument.docType,
      subjectType: oldDocument.subjectType,
      subjectId: oldDocument.subjectId,
      templateVersion: oldDocument.templateVersion,
      ruleSetVersion: oldDocument.ruleSetVersion,
      inputSnapshotHash: sha256Hex(canonicalJsonString(input.correctedValues)),
      generatedObjectUri: objectUri,
      generatedSha256: sha256,
      contentStatus: "draft",
    });

    await tx
      .update(documents)
      .set({ contentStatus: "superseded", supersededByDocumentId: newDocumentId })
      .where(eq(documents.id, oldDocument.id));

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: oldDocument.id,
      aggregateVersion: oldDocument.version,
      eventType: "document.superseded",
      beforeHash: oldDocument.generatedSha256 ?? undefined,
      afterHash: sha256,
      principal: input.principal,
      requestId: input.requestId,
    });

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: newDocumentId,
      aggregateVersion: newVersion,
      eventType: "document.draft_generated",
      afterHash: sha256,
      principal: input.principal,
      requestId: input.requestId,
    });

    return { newDocumentId, newVersion };
  });
}

/**
 * document.attach_executed_copyの中核処理：署名済み正本（スキャン/電子署名）を保存し、
 * execution_statusをunsigned→executedへ遷移させる
 * Core logic for document.attach_executed_copy: stores the signed original (scan/e-signature) and
 * transitions execution_status unsigned -> executed
 * Logika inti document.attach_executed_copy: menyimpan naskah asli yang ditandatangani (scan/e-signature) dan
 * mentransisikan execution_status unsigned -> executed
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { documents } from "../../db/schema/documents.js";
import { assertExecutionTransition } from "./state-machine.js";
import { putImmutableObject } from "../../lib/storage.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface AttachExecutedCopyInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  documentId: string;
  executedBytesBase64: string;
  contentType: string;
}

export async function attachExecutedCopy(db: Db, input: AttachExecutedCopyInput): Promise<{ executedSha256: string }> {
  return db.transaction(async (tx) => {
    const [document] = await tx.select().from(documents).where(eq(documents.id, input.documentId));
    if (!document) {
      throw new UserInputError(
        `document ${input.documentId} が見つかりません / document ${input.documentId} not found`,
        "documentIdを確認してください / Please verify documentId",
      );
    }
    if (document.contentStatus !== "approved") {
      throw new UserInputError(
        "承認済みでない文書には署名済み正本を添付できません / Cannot attach an executed copy to a non-approved document",
        "先にdocument.approveで承認してください / Please approve the document via document.approve first",
      );
    }

    assertExecutionTransition(document.executionStatus, "executed");

    const bytes = Buffer.from(input.executedBytesBase64, "base64");
    const { objectUri, sha256 } = await putImmutableObject("documents/executed", bytes, input.contentType);

    await tx
      .update(documents)
      .set({ executedObjectUri: objectUri, executedSha256: sha256, executionStatus: "executed" })
      .where(eq(documents.id, input.documentId));

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: document.id,
      aggregateVersion: document.version,
      eventType: "document.executed_copy_attached",
      afterHash: sha256,
      principal: input.principal,
      requestId: input.requestId,
    });

    return { executedSha256: sha256 };
  });
}

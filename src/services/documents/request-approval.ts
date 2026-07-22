/**
 * document.request_approvalの中核処理：承認対象PDFのhash・nonce・期限を持つapproval_requestsを作成し、
 * content_statusをdraft→under_reviewへ遷移させる
 * Core logic for document.request_approval: creates an approval_requests row carrying the artifact hash, nonce, and
 * expiry, and transitions content_status draft -> under_review
 * Logika inti document.request_approval: membuat baris approval_requests yang membawa hash artifact, nonce, dan
 * kedaluwarsa, dan mentransisikan content_status draft -> under_review
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { approvalRequests, documents } from "../../db/schema/documents.js";
import { assertContentTransition } from "./state-machine.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

const DEFAULT_EXPIRY_HOURS = 72;

export interface RequestApprovalInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  documentId: string;
  requiredRole: string;
  proposedDiff?: Record<string, unknown>;
}

export interface RequestApprovalResult {
  approvalRequestId: string;
  nonce: string;
  expiresAt: Date;
}

export async function requestDocumentApproval(db: Db, input: RequestApprovalInput): Promise<RequestApprovalResult> {
  return db.transaction(async (tx) => {
    const [document] = await tx.select().from(documents).where(eq(documents.id, input.documentId));
    if (!document) {
      throw new UserInputError(
        `document ${input.documentId} が見つかりません / document ${input.documentId} not found`,
        "documentIdを確認してください / Please verify documentId",
      );
    }
    if (!document.generatedSha256) {
      throw new UserInputError(
        "承認対象のハッシュが未生成です / The document has no generated hash yet",
        "先にdocument.generate_draftを実行してください / Please run document.generate_draft first",
      );
    }

    assertContentTransition(document.contentStatus, "under_review");

    const approvalRequestId = randomUUID();
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000);

    await tx.insert(approvalRequests).values({
      id: approvalRequestId,
      tenantId: input.tenantId,
      documentId: document.id,
      subjectType: document.subjectType,
      subjectId: document.subjectId,
      subjectVersion: document.version,
      requestedAction: "document.approve",
      artifactSha256: document.generatedSha256,
      proposedDiff: input.proposedDiff,
      requiredRole: input.requiredRole,
      requestedBy: input.principal.principalId,
      nonce,
      expiresAt,
    });

    await tx.update(documents).set({ contentStatus: "under_review" }).where(eq(documents.id, input.documentId));

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: document.id,
      aggregateVersion: document.version,
      eventType: "document.approval_requested",
      afterHash: document.generatedSha256,
      principal: input.principal,
      requestId: input.requestId,
    });

    return { approvalRequestId, nonce, expiresAt };
  });
}

/**
 * document.approveの中核処理：確定ゲート。ambiguous/expert_review_requiredをブロックし、
 * 承認対象hashの不一致を自動void、承認者は認証主体から導出する（§4.6・§3.1）
 * Core logic for document.approve: the finalization gate. Blocks ambiguous/expert_review_required,
 * auto-voids on artifact hash mismatch, and derives the approver from the authenticated principal (§4.6, §3.1)
 * Logika inti document.approve: gate finalisasi. Memblokir ambiguous/expert_review_required,
 * otomatis membatalkan saat hash artifact tidak cocok, dan menurunkan approver dari principal terautentikasi (§4.6, §3.1)
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { approvalRequests, documents } from "../../db/schema/documents.js";
import { assertContentTransition } from "./state-machine.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { evaluateSubjectCompliance } from "../rules/evaluate-subject.js";
import { assertNoBlockingFindings } from "../rules/five-value-result.js";
import { SUBJECT_TYPE_MAPPING_FILE, loadSubjectRow } from "../rules/subject-lookup.js";
import { getDocTypeDefinition } from "./doc-type-registry.js";
import { InvalidTransitionError, UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface ApproveDocumentInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  approvalRequestId: string;
  decision: "approved" | "rejected";
  decisionReason: string;
}

export interface ApproveDocumentResult {
  documentId: string;
  contentStatus: string;
}

export async function approveDocument(db: Db, input: ApproveDocumentInput): Promise<ApproveDocumentResult> {
  // 期限切れ・hash不一致による自動void判定は、後続のメイン処理が失敗してロールバックしても
  // void結果自体は必ず残るよう、独立したトランザクションで先にコミットしてから例外を投げる
  // Expiry/hash-mismatch auto-void decisions are committed in their own transaction first, so the void
  // itself survives even though the caller subsequently receives (and may roll back on) an error
  // Keputusan auto-void karena kedaluwarsa/ketidakcocokan hash di-commit dahulu dalam transaksi sendiri,
  // sehingga void itu sendiri tetap ada meskipun pemanggil kemudian menerima error
  const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, input.approvalRequestId));
  if (!approval) {
    throw new UserInputError(
      `approval_request ${input.approvalRequestId} が見つかりません / approval_request ${input.approvalRequestId} not found`,
      "approvalRequestIdを確認してください / Please verify approvalRequestId",
    );
  }
  if (approval.decision) {
    throw new InvalidTransitionError(
      `この承認依頼は既に${approval.decision}済みです / This approval request is already decided as ${approval.decision}`,
    );
  }
  if (approval.expiresAt.getTime() < Date.now()) {
    await db.update(approvalRequests).set({ decision: "expired" }).where(eq(approvalRequests.id, approval.id));
    throw new InvalidTransitionError("承認依頼の期限が切れています / The approval request has expired");
  }

  const [currentDocumentPreCheck] = await db.select().from(documents).where(eq(documents.id, approval.documentId));

  if (!currentDocumentPreCheck) {
    throw new UserInputError(
      "対象文書が見つかりません / The target document was not found",
      "documentIdを確認してください / Please verify the document",
    );
  }

  // 1バイトでも変わればhash不一致で承認は自動void / A single-byte change causes an automatic void via hash mismatch / Perubahan satu byte pun otomatis membatalkan via ketidakcocokan hash
  if (currentDocumentPreCheck.generatedSha256 !== approval.artifactSha256) {
    await db
      .update(approvalRequests)
      .set({ decision: "rejected", decisionReason: "artifact_hash_mismatch" })
      .where(eq(approvalRequests.id, approval.id));
    throw new InvalidTransitionError(
      "承認対象のハッシュが一致しないため、承認を自動的に無効化しました（原本が変更されています） / Approval auto-voided due to artifact hash mismatch (the source document changed)",
    );
  }

  return db.transaction(async (tx) => {
    // 並行リクエストによる二重決定を防ぐため、トランザクション内でロックを取り直して再確認する
    // Re-checks under a row lock inside the transaction to guard against a concurrent double-decision
    // Memeriksa ulang di bawah row lock dalam transaksi untuk mencegah keputusan ganda yang bersamaan
    const [lockedApproval] = await tx
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, approval.id))
      .for("update");
    if (lockedApproval?.decision) {
      throw new InvalidTransitionError(
        `この承認依頼は既に${lockedApproval.decision}済みです / This approval request is already decided as ${lockedApproval.decision}`,
      );
    }

    const [currentDocument] = await tx.select().from(documents).where(eq(documents.id, approval.documentId));

    if (!currentDocument) {
      throw new UserInputError(
        "対象文書が見つかりません / The target document was not found",
        "documentIdを確認してください / Please verify the document",
      );
    }

    if (input.decision === "approved") {
      // docType単位で解決する（dispatch_assignmentはA2/A3/A10/labor_conditions_noticeを併せ持つためsubjectTypeだけでは曖昧）。
      // job_orderのようにdoc-type-registryに未登録のsubjectTypeはSUBJECT_TYPE_MAPPING_FILEへフォールバックする
      // Resolved per-docType (subjectType alone is ambiguous for dispatch_assignment, which can back A2/A3/A10/labor_conditions_notice).
      // Falls back to SUBJECT_TYPE_MAPPING_FILE for subjectTypes not registered in doc-type-registry (e.g. job_order)
      const mappingFileName = getDocTypeDefinition(currentDocument.docType)?.mappingFileName ?? SUBJECT_TYPE_MAPPING_FILE[approval.subjectType];
      if (mappingFileName) {
        const subjectRow = await loadSubjectRow(tx, approval.subjectType, approval.subjectId);
        if (subjectRow) {
          const findings = await evaluateSubjectCompliance(tx, {
            tenantId: input.tenantId,
            subjectType: approval.subjectType,
            subjectId: approval.subjectId,
            mappingFileName,
            row: subjectRow,
          });
          // ambiguous/expert_review_requiredはコードレベルで書類確定をブロックする（§3.1） / ambiguous/expert_review_required blocks finalization at the code level (§3.1) / ambiguous/expert_review_required memblokir finalisasi di level kode (§3.1)
          assertNoBlockingFindings(findings);
        }
      }

      assertContentTransition(currentDocument.contentStatus, "approved");

      await tx
        .update(approvalRequests)
        .set({ decision: "approved", approvedBy: input.principal.principalId, approvedAt: new Date() })
        .where(eq(approvalRequests.id, approval.id));

      await tx.update(documents).set({ contentStatus: "approved" }).where(eq(documents.id, currentDocument.id));

      await appendAuditEvent(tx, {
        tenantId: input.tenantId,
        aggregateType: "document",
        aggregateId: currentDocument.id,
        aggregateVersion: currentDocument.version,
        eventType: "document.approved",
        afterHash: currentDocument.generatedSha256 ?? "",
        principal: input.principal,
        requestId: input.requestId,
      });

      return { documentId: currentDocument.id, contentStatus: "approved" };
    }

    await tx
      .update(approvalRequests)
      .set({ decision: "rejected", decisionReason: input.decisionReason, approvedBy: input.principal.principalId, approvedAt: new Date() })
      .where(eq(approvalRequests.id, approval.id));

    assertContentTransition(currentDocument.contentStatus, "draft");
    await tx.update(documents).set({ contentStatus: "draft" }).where(eq(documents.id, currentDocument.id));

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: currentDocument.id,
      aggregateVersion: currentDocument.version,
      eventType: "document.rejected",
      afterHash: currentDocument.generatedSha256 ?? "",
      principal: input.principal,
      requestId: input.requestId,
    });

    return { documentId: currentDocument.id, contentStatus: "draft" };
  });
}

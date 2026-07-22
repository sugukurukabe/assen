/**
 * MCP App承認画面のリソース登録：ui://approval/{approvalRequestId}（mimeType: text/html）。
 * sandboxed iframeでホストに描画される想定。業務データの読み取りのみを行い、書込はdocument.approve側で行う
 * Resource registration for the MCP App approval screen: ui://approval/{approvalRequestId} (mimeType: text/html).
 * Rendered by the host inside a sandboxed iframe. Only reads business data; writes happen via document.approve
 * Registrasi resource untuk layar persetujuan MCP App: ui://approval/{approvalRequestId} (mimeType: text/html).
 * Dirender oleh host di dalam sandboxed iframe. Hanya membaca data bisnis; penulisan terjadi via document.approve
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import type { ServiceContext } from "../../protocol/service-context.js";
import { approvalRequests, documents } from "../../db/schema/documents.js";
import { getObjectBytes } from "../../lib/storage.js";
import { evaluateSubjectCompliance } from "../../services/rules/evaluate-subject.js";
import { SUBJECT_TYPE_MAPPING_FILE, loadSubjectRow } from "../../services/rules/subject-lookup.js";
import { renderApprovalUiHtml } from "./render.js";

async function loadRenderedText(objectUri: string | null): Promise<string | null> {
  if (!objectUri) {
    return null;
  }
  try {
    const bytes = await getObjectBytes(objectUri);
    return bytes.toString("utf8");
  } catch {
    return null;
  }
}

export function registerApprovalUiResource(server: McpServer, context: ServiceContext): void {
  const template = new ResourceTemplate("ui://approval/{approvalRequestId}", {
    list: async () => ({ resources: [] }),
  });

  server.registerResource(
    "approval-ui",
    template,
    {
      title: "書類承認画面 / Document approval screen / Layar persetujuan dokumen",
      description:
        "MCP App承認画面。生成文書プレビュー・前版差分・法定必須項目の充足状況・出典・findings・承認後に起こる処理を1画面で表示し、承認/差戻しを行える。 / MCP App approval screen. Shows the generated-document preview, diff against the previous version, legal-field completeness, provenance, findings, and post-approval consequences in one screen, with approve/reject actions. / Layar persetujuan MCP App. Menampilkan preview dokumen yang dihasilkan, diff terhadap versi sebelumnya, kelengkapan field hukum, provenance, findings, dan konsekuensi setelah persetujuan dalam satu layar, dengan aksi setuju/tolak.",
      mimeType: "text/html",
    },
    async (uri, variables) => {
      const approvalRequestId = String(variables.approvalRequestId);
      const [approval] = await context.db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalRequestId));

      if (!approval) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/html",
              text: `<!doctype html><html><body><p>approval_request ${approvalRequestId} が見つかりません / not found</p></body></html>`,
            },
          ],
        };
      }

      const [currentDocument] = await context.db.select().from(documents).where(eq(documents.id, approval.documentId));

      if (!currentDocument) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/html",
              text: `<!doctype html><html><body><p>対象文書が見つかりません / target document not found</p></body></html>`,
            },
          ],
        };
      }

      const [previousDocument] =
        currentDocument.version > 1
          ? await context.db
              .select()
              .from(documents)
              .where(
                and(
                  eq(documents.logicalDocumentId, currentDocument.logicalDocumentId),
                  eq(documents.version, currentDocument.version - 1),
                ),
              )
          : [];

      const [renderedText, previousRenderedText] = await Promise.all([
        loadRenderedText(currentDocument.generatedObjectUri),
        loadRenderedText(previousDocument?.generatedObjectUri ?? null),
      ]);

      const mappingFileName = SUBJECT_TYPE_MAPPING_FILE[approval.subjectType];
      const subjectRow = mappingFileName ? await loadSubjectRow(context.db, approval.subjectType, approval.subjectId) : undefined;
      const findings =
        mappingFileName && subjectRow
          ? await evaluateSubjectCompliance(context.db, {
              tenantId: context.principal.tenantId,
              subjectType: approval.subjectType,
              subjectId: approval.subjectId,
              mappingFileName,
              row: subjectRow,
            })
          : [];

      const html = renderApprovalUiHtml({
        approvalRequestId: approval.id,
        nonce: approval.nonce,
        requiredRole: approval.requiredRole,
        requestedBy: approval.requestedBy,
        requestedAt: approval.requestedAt.toISOString(),
        expiresAt: approval.expiresAt.toISOString(),
        decision: approval.decision,
        decisionReason: approval.decisionReason,
        document: {
          id: currentDocument.id,
          logicalDocumentId: currentDocument.logicalDocumentId,
          version: currentDocument.version,
          docType: currentDocument.docType,
          contentStatus: currentDocument.contentStatus,
          generatedSha256: currentDocument.generatedSha256,
        },
        renderedText: renderedText ?? "(プレビューを取得できませんでした / preview unavailable)",
        previousRenderedText,
        findings,
        evidenceRefs: [
          `assen://audit/${approval.subjectType}/${approval.subjectId}`,
          `assen://audit/document/${currentDocument.id}`,
          `assen://documents/${currentDocument.logicalDocumentId}/${currentDocument.version}`,
        ],
        postApprovalActions: [
          "content_statusがapprovedへ遷移する / content_status transitions to approved / content_status bertransisi ke approved",
          "document.attach_executed_copyで署名済み正本の添付が可能になる / document.attach_executed_copy becomes available for the signed original / document.attach_executed_copy menjadi tersedia untuk naskah asli yang ditandatangani",
          "audit_eventsにdocument.approvedが1件追記される（actor・時刻・ハッシュ付き） / A document.approved audit event is appended (with actor/timestamp/hash) / Satu event audit document.approved ditambahkan (dengan actor/waktu/hash)",
        ],
      });

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/html",
            text: html,
          },
        ],
      };
    },
  );
}

/**
 * MCP App承認画面のHTML生成（§7「MCP App（承認画面）」）。sandboxed iframeで完結する自己完結HTMLを返す。
 * 表示要素：生成文書プレビュー／前版差分／法定必須項目の充足状況／出典（source_locator）／confidence・矛盾／
 * 未解決findings／承認後に起こる処理。操作：承認・差戻し（訂正・署名済みコピー添付は別ツールへの案内表示のみ）。
 * 業務データはサーバー側に保持し、この画面は表示専用の一時状態のみを持つ
 *
 * HTML generator for the MCP App approval screen (design doc §7 "MCP App (approval screen)"). Returns
 * self-contained HTML that runs entirely inside a sandboxed iframe. Shown elements: generated-document
 * preview / diff against the previous version / legal-required-field completeness / provenance
 * (source_locator) / confidence & conflicts / unresolved findings / what happens after approval. Actions:
 * approve/reject (correction and signed-copy attachment are only pointed to as separate tools). Business
 * data stays server-side; this screen holds only ephemeral display state
 *
 * Generator HTML untuk layar persetujuan MCP App (§7 dokumen desain "MCP App (layar persetujuan)").
 * Mengembalikan HTML mandiri yang berjalan sepenuhnya di dalam sandboxed iframe. Elemen yang ditampilkan:
 * preview dokumen yang dihasilkan / diff terhadap versi sebelumnya / kelengkapan field wajib hukum /
 * provenance (source_locator) / confidence & konflik / findings yang belum terselesaikan / apa yang terjadi
 * setelah persetujuan. Aksi: setuju/tolak (koreksi dan lampiran copy yang ditandatangani hanya diarahkan ke
 * tool terpisah). Data bisnis tetap di sisi server; layar ini hanya memiliki status tampilan sementara
 */
import { diffLines } from "./diff-lines.js";
import type { Finding } from "../../services/rules/five-value-result.js";

export interface ApprovalUiDocumentSummary {
  id: string;
  logicalDocumentId: string;
  version: number;
  docType: string;
  contentStatus: string;
  generatedSha256: string | null;
}

export interface ApprovalUiData {
  approvalRequestId: string;
  nonce: string;
  requiredRole: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  decision: string | null;
  decisionReason: string | null;
  document: ApprovalUiDocumentSummary;
  renderedText: string;
  previousRenderedText: string | null;
  findings: Finding[];
  evidenceRefs: string[];
  postApprovalActions: string[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  blocking: "🛑 blocking",
  warning: "⚠️ warning",
  info: "ℹ️ info",
};

const RESULT_LABEL: Record<Finding["result"], string> = {
  pass: "pass",
  fail: "fail",
  incomplete: "incomplete",
  ambiguous: "ambiguous",
  expert_review_required: "expert_review_required",
};

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return `<p class="ok">未解決のfindingsはありません（5値判定はpass） / No unresolved findings (5-value result is pass) / Tidak ada findings yang belum terselesaikan (hasil 5 nilai adalah pass)</p>`;
  }
  const rows = findings
    .map(
      (finding) => `
        <tr class="finding-${escapeHtml(finding.severity)}">
          <td>${SEVERITY_LABEL[finding.severity]}</td>
          <td><code>${escapeHtml(finding.ruleKey)}</code></td>
          <td>${RESULT_LABEL[finding.result]}</td>
          <td>${escapeHtml(finding.message)}</td>
          <td>${finding.missingFields.map((field) => `<code>${escapeHtml(field)}</code>`).join(", ")}</td>
        </tr>`,
    )
    .join("");
  return `
    <table class="findings">
      <thead><tr><th>severity</th><th>rule</th><th>result</th><th>message</th><th>missing fields</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderDiff(before: string | null, after: string): string {
  if (before === null) {
    return `<p class="muted">前版はありません（初版のドラフト） / No previous version (this is the first draft) / Tidak ada versi sebelumnya (ini draft pertama)</p>`;
  }
  const lines = diffLines(before, after);
  const rendered = lines
    .map((line) => {
      const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
      return `<div class="diff-line diff-${line.kind}">${escapeHtml(prefix)} ${escapeHtml(line.text)}</div>`;
    })
    .join("");
  return `<div class="diff">${rendered}</div>`;
}

export function renderApprovalUiHtml(data: ApprovalUiData): string {
  const isDecided = data.decision !== null;
  const hasBlockingFindings = data.findings.some((finding) => finding.severity === "blocking");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>書類承認 / Document Approval / Persetujuan Dokumen</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; margin: 0; padding: 16px; line-height: 1.5; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.7; margin: 20px 0 8px; }
  .meta { font-size: 12px; opacity: 0.75; margin-bottom: 16px; }
  .meta code { font-size: 11px; }
  section { border: 1px solid rgba(128,128,128,0.3); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; background: rgba(128,128,128,0.08); padding: 10px; border-radius: 6px; font-size: 13px; max-height: 320px; overflow: auto; }
  table.findings { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.findings th, table.findings td { border-bottom: 1px solid rgba(128,128,128,0.25); padding: 6px 8px; text-align: left; vertical-align: top; }
  .finding-blocking { background: rgba(220,38,38,0.08); }
  .finding-warning { background: rgba(217,119,6,0.08); }
  .ok { color: #16a34a; font-weight: 600; }
  .muted { opacity: 0.6; }
  .diff { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; background: rgba(128,128,128,0.08); padding: 8px; border-radius: 6px; max-height: 260px; overflow: auto; }
  .diff-line { white-space: pre-wrap; }
  .diff-added { background: rgba(22,163,74,0.15); }
  .diff-removed { background: rgba(220,38,38,0.15); text-decoration: line-through; }
  .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  textarea { width: 100%; box-sizing: border-box; font-family: inherit; font-size: 13px; padding: 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.4); resize: vertical; min-height: 48px; }
  button { font-size: 13px; padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; }
  button.approve { background: #16a34a; color: white; }
  button.approve:disabled, button.reject:disabled { opacity: 0.4; cursor: not-allowed; }
  button.reject { background: #dc2626; color: white; }
  #bridge-status { font-size: 12px; margin-top: 10px; opacity: 0.75; }
  #manual-fallback { display: none; margin-top: 10px; }
  #manual-fallback pre { font-size: 11px; }
  ul.evidence { font-size: 12px; padding-left: 18px; }
  ul.post-approval { font-size: 13px; padding-left: 18px; }
</style>
</head>
<body>
  <h1>書類承認 / Document Approval / Persetujuan Dokumen</h1>
  <div class="meta">
    document_id: <code>${escapeHtml(data.document.id)}</code> ・
    version: <code>${data.document.version}</code> ・
    doc_type: <code>${escapeHtml(data.document.docType)}</code> ・
    content_status: <code>${escapeHtml(data.document.contentStatus)}</code><br/>
    approval_request_id: <code>${escapeHtml(data.approvalRequestId)}</code> ・
    nonce: <code>${escapeHtml(data.nonce)}</code> ・
    required_role: <code>${escapeHtml(data.requiredRole)}</code><br/>
    requested_by: <code>${escapeHtml(data.requestedBy)}</code> ・
    requested_at: <code>${escapeHtml(data.requestedAt)}</code> ・
    expires_at: <code>${escapeHtml(data.expiresAt)}</code><br/>
    artifact_sha256: <code>${escapeHtml(data.document.generatedSha256 ?? "(none)")}</code>
  </div>

  <section>
    <h2>生成文書プレビュー / Generated document preview / Preview dokumen yang dihasilkan</h2>
    <pre>${escapeHtml(data.renderedText)}</pre>
  </section>

  <section>
    <h2>前版との差分 / Diff against the previous version / Diff terhadap versi sebelumnya</h2>
    ${renderDiff(data.previousRenderedText, data.renderedText)}
  </section>

  <section>
    <h2>法定必須項目の充足状況・矛盾・信頼度 / Legal-field completeness, conflicts, confidence / Kelengkapan field hukum, konflik, confidence</h2>
    ${renderFindings(data.findings)}
  </section>

  <section>
    <h2>出典 / Provenance / Provenance</h2>
    <ul class="evidence">
      ${data.evidenceRefs.map((ref) => `<li><code>${escapeHtml(ref)}</code></li>`).join("") || '<li class="muted">なし / none / tidak ada</li>'}
    </ul>
  </section>

  <section>
    <h2>承認後に起こる処理 / What happens after approval / Apa yang terjadi setelah persetujuan</h2>
    <ul class="post-approval">
      ${data.postApprovalActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
    </ul>
  </section>

  <section>
    <h2>操作 / Actions / Aksi</h2>
    ${
      isDecided
        ? `<p class="muted">この承認依頼は既に「${escapeHtml(data.decision ?? "")}」として決定済みです（${escapeHtml(data.decisionReason ?? "")}） / This approval request is already decided as "${escapeHtml(data.decision ?? "")}" / Permintaan persetujuan ini sudah diputuskan sebagai "${escapeHtml(data.decision ?? "")}"</p>`
        : `
    ${hasBlockingFindings ? `<p class="finding-blocking" style="padding:8px;border-radius:6px;">blockingなfindingsが残っているため、承認はサーバー側で拒否されます（差戻しは可能） / Approval will be rejected server-side while blocking findings remain (rejection is still possible) / Persetujuan akan ditolak di sisi server selama findings blocking masih ada (penolakan tetap memungkinkan)</p>` : ""}
    <textarea id="decisionReason" placeholder="判断理由（承認・差戻しとも必須） / Decision reason (required for both approve/reject) / Alasan keputusan (wajib untuk setuju/tolak)"></textarea>
    <div class="actions">
      <button class="approve" id="approveBtn" ${hasBlockingFindings ? "disabled" : ""}>承認 / Approve / Setuju</button>
      <button class="reject" id="rejectBtn">差戻し / Reject / Tolak</button>
    </div>
    <div id="bridge-status" class="muted"></div>
    <div id="manual-fallback">
      <p class="muted">このMCPクライアントはUIからのtool呼び出しに対応していません。以下をチャットに貼り付けて実行してください。 / This MCP client does not support invoking tools from the UI. Paste the following into the chat instead. / Klien MCP ini tidak mendukung pemanggilan tool dari UI. Tempelkan berikut ini ke chat sebagai gantinya.</p>
      <pre id="manual-payload"></pre>
    </div>
    `
    }
  </section>

  <script>
    (function () {
      var approvalRequestId = ${JSON.stringify(data.approvalRequestId)};
      var approveBtn = document.getElementById("approveBtn");
      var rejectBtn = document.getElementById("rejectBtn");
      var statusEl = document.getElementById("bridge-status");
      var fallbackEl = document.getElementById("manual-fallback");
      var payloadEl = document.getElementById("manual-payload");
      var reasonEl = document.getElementById("decisionReason");

      function callDocumentApprove(decision) {
        var decisionReason = (reasonEl && reasonEl.value || "").trim();
        if (!decisionReason) {
          alert("判断理由を入力してください / Please enter a decision reason / Silakan masukkan alasan keputusan");
          return;
        }
        var toolName = "document.approve";
        var params = { approvalRequestId: approvalRequestId, decision: decision, decisionReason: decisionReason };

        // 1) OpenAI Apps SDK方式のブリッジ（window.openai.callTool） / OpenAI Apps SDK-style bridge / Bridge gaya OpenAI Apps SDK
        if (window.openai && typeof window.openai.callTool === "function") {
          statusEl.textContent = "window.openai.callToolで送信しました / Sent via window.openai.callTool / Dikirim via window.openai.callTool";
          window.openai.callTool(toolName, params);
          return;
        }
        // 2) mcp-ui方式のpostMessageブリッジ（ホストがwindow.parentでlistenしている想定） / mcp-ui-style postMessage bridge (assumes the host listens on window.parent) / Bridge postMessage gaya mcp-ui (mengasumsikan host mendengarkan di window.parent)
        if (window.parent && window.parent !== window) {
          statusEl.textContent = "postMessageで送信しました（ホストの対応状況は不明） / Sent via postMessage (host support unknown) / Dikirim via postMessage (dukungan host tidak diketahui)";
          window.parent.postMessage({ type: "tool", payload: { toolName: toolName, params: params } }, "*");
          return;
        }
        // 3) フォールバック：手動実行用のtool呼び出しを表示する / Fallback: show the tool call for manual execution / Fallback: tampilkan pemanggilan tool untuk eksekusi manual
        statusEl.textContent = "対応ブリッジが見つかりませんでした / No compatible bridge found / Tidak ditemukan bridge yang kompatibel";
        fallbackEl.style.display = "block";
        payloadEl.textContent = JSON.stringify({ tool: toolName, arguments: params }, null, 2);
      }

      if (approveBtn) {
        approveBtn.addEventListener("click", function () { callDocumentApprove("approved"); });
      }
      if (rejectBtn) {
        rejectBtn.addEventListener("click", function () { callDocumentApprove("rejected"); });
      }
    })();
  </script>
</body>
</html>`;
}

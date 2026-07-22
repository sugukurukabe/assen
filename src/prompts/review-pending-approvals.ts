/**
 * 承認待ち文書のレビュー業務フロープロンプト
 * Workflow prompt for reviewing pending document approvals
 * Prompt workflow untuk meninjau persetujuan dokumen yang tertunda
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";

export function registerReviewPendingApprovalsPrompt(server: McpServer, _context: ServiceContext): void {
  server.registerPrompt(
    "review-pending-approvals",
    {
      title: "承認待ちの書類をレビューする",
      description:
        "document.previewとcompliance.evaluateの結果を確認し、document.approveで承認または差戻しするワークフロー / Workflow that reviews document.preview and compliance.evaluate output, then approves or rejects via document.approve / Workflow yang meninjau output document.preview dan compliance.evaluate, lalu menyetujui atau menolak via document.approve",
      argsSchema: {
        approvalRequestId: z.string().describe("レビュー対象のapproval_request ID / Target approval_request id / ID approval_request target"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `approval_request ${args.approvalRequestId} をレビューしてください。`,
              "1. 対象文書のdocument.previewで差込値・出典・充足状況を確認する",
              "2. ambiguous/expert_review_requiredのfindingsが残っていないか確認する（残っている場合は承認できない）",
              "3. 問題がなければdocument.approveでdecision=approvedを、問題があればdecision=rejectedとdecisionReasonを渡す",
              "4. 承認後はdocument.attach_executed_copy→document.record_deliveryへ進める",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

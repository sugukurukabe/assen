/**
 * document.supersede：訂正版発行（理由必須・旧版はsuperseded）。write系
 * document.supersede: issues a corrected version (reason mandatory; the old version becomes superseded). Write tool
 * document.supersede: menerbitkan versi yang dikoreksi (alasan wajib; versi lama menjadi superseded). Tool write
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { supersedeDocument } from "../services/documents/supersede.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { InvalidTransitionError, UserInputError } from "../lib/errors.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  documentId: z.string().uuid().describe("訂正対象の現行documentのID / Current documentId to correct / documentId saat ini yang akan dikoreksi"),
  reason: z.string().min(1).describe("訂正理由（必須） / Correction reason (mandatory) / Alasan koreksi (wajib)"),
  correctedValues: z
    .record(z.string(), z.unknown())
    .describe("訂正後の差込値（テンプレート変数） / Corrected template values / Nilai template yang dikoreksi"),
};

export function registerDocumentSupersede(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "document.supersede",
    {
      title: "書類の訂正版を発行する",
      description:
        "旧版をsupersededにし、訂正済みの値で新版（draft）を発行する。理由は必須。 / Marks the old version as superseded and issues a new draft with corrected values. Reason is mandatory. / Menandai versi lama sebagai superseded dan menerbitkan draft baru dengan nilai yang dikoreksi. Alasan wajib.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "approver", "admin"]);

        const result = await supersedeDocument(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          documentId: args.documentId,
          reason: args.reason,
          correctedValues: args.correctedValues,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: result.newDocumentId,
          subjectVersion: result.newVersion,
          status: "draft",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://documents/${result.newDocumentId}`],
          nextActions: ["document.request_approvalで新版の承認依頼を作成してください"],
        });
      } catch (error) {
        if (error instanceof UserInputError || error instanceof InvalidTransitionError) {
          return toToolErrorResult(error.message, error instanceof UserInputError ? error.remediation : undefined);
        }
        logMessage("error", "document.supersedeに失敗しました / document.supersede failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("訂正版の発行に失敗しました / Failed to issue the corrected version");
      }
    },
  );
}

/**
 * document.attach_executed_copy：署名済み正本（スキャン/電子署名）の添付＋hash登録。write系
 * document.attach_executed_copy: attaches the signed original (scan/e-signature) and registers its hash. Write tool
 * document.attach_executed_copy: melampirkan naskah asli yang ditandatangani (scan/e-signature) dan mendaftarkan hash-nya. Tool write
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { attachExecutedCopy } from "../services/documents/attach-executed-copy.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { InvalidTransitionError, UserInputError } from "../lib/errors.js";
import { logMessage } from "../lib/logger.js";

// base64で約15MB相当（署名済みスキャンPDFを想定した上限）。MAX_REQUEST_BODY_BYTESの本文上限と整合させる
// ~15MB decoded once base64 is stripped (sized for a signed scan PDF). Kept under MAX_REQUEST_BODY_BYTES
// ~15MB setelah base64 didekode (disesuaikan untuk PDF scan yang ditandatangani). Tetap di bawah MAX_REQUEST_BODY_BYTES
const MAX_EXECUTED_COPY_BASE64_CHARS = 20_000_000;

const inputSchema = {
  documentId: z.string().uuid().describe("対象documentのID / Target documentId / documentId target"),
  executedBytesBase64: z
    .string()
    .min(1)
    .max(MAX_EXECUTED_COPY_BASE64_CHARS)
    .describe("署名済み正本のbase64エンコードバイト列（上限約15MB相当） / Base64-encoded bytes of the signed original (capped at ~15MB decoded) / Byte base64 dari naskah asli yang ditandatangani (dibatasi ~15MB setelah didekode)"),
  contentType: z.string().min(1).default("application/pdf").describe("MIMEタイプ / MIME type / Tipe MIME"),
};

export function registerDocumentAttachExecutedCopy(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "document.attach_executed_copy",
    {
      title: "署名済み正本を添付する",
      description:
        "承認済み文書に署名済み正本（紙スキャン/電子署名）を添付し、SHA-256を記録する。execution_statusはexecutedになる。 / Attaches the signed original (paper scan/e-signature) to an approved document and records its SHA-256. execution_status becomes executed. / Melampirkan naskah asli yang ditandatangani (scan kertas/e-signature) ke dokumen yang disetujui dan mencatat SHA-256-nya. execution_status menjadi executed.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "admin"]);

        const result = await attachExecutedCopy(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          documentId: args.documentId,
          executedBytesBase64: args.executedBytesBase64,
          contentType: args.contentType,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: args.documentId,
          subjectVersion: 1,
          status: "executed",
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://documents/${args.documentId}`],
          nextActions: ["document.record_deliveryで交付記録を登録してください"],
          executedSha256: result.executedSha256,
        });
      } catch (error) {
        if (error instanceof UserInputError || error instanceof InvalidTransitionError) {
          return toToolErrorResult(error.message, error instanceof UserInputError ? error.remediation : undefined);
        }
        logMessage("error", "document.attach_executed_copyに失敗しました / document.attach_executed_copy failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("署名済み正本の添付に失敗しました / Failed to attach the executed copy");
      }
    },
  );
}

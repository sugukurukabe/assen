/**
 * document.record_delivery：交付記録（方法・日時・電子交付同意・メッセージID）。write系（openWorld）
 * document.record_delivery: records delivery (method/time/e-delivery consent/message id). Write tool (openWorld)
 * document.record_delivery: mencatat pengiriman (metode/waktu/persetujuan e-delivery/id pesan). Tool write (openWorld)
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../protocol/service-context.js";
import { assertScope } from "../lib/auth.js";
import { recordDelivery } from "../services/documents/record-delivery.js";
import { toToolErrorResult, toToolResult } from "./common-envelope.js";
import { InvalidTransitionError, UserInputError } from "../lib/errors.js";
import { logMessage } from "../lib/logger.js";

const inputSchema = {
  documentId: z.string().uuid().describe("対象documentのID / Target documentId / documentId target"),
  deliveryStatus: z.enum(["queued", "sent", "delivered", "failed"]).describe("交付状態 / Delivery status / Status pengiriman"),
  method: z.string().min(1).describe("交付方法（メール/Slack/対面等） / Delivery method / Metode pengiriman"),
  messageId: z.string().optional().describe("メッセージID（追跡用） / Message id for tracking / ID pesan untuk pelacakan"),
  electronicConsent: z.boolean().optional().describe("電子交付についての同意有無 / Whether e-delivery was consented to / Apakah e-delivery disetujui"),
  deliveredAt: z.string().optional().describe("交付日時(ISO8601) / Delivery timestamp / Waktu pengiriman"),
};

export function registerDocumentRecordDelivery(server: McpServer, context: ServiceContext): void {
  server.registerTool(
    "document.record_delivery",
    {
      title: "書類の交付を記録する",
      description:
        "交付方法・日時・電子交付同意・メッセージIDを記録し、delivery_statusを遷移させる。外部送信を伴うためopenWorldHint=trueとし、必ずプレビュー後に呼ぶこと。 / Records delivery method/time/e-delivery consent/message id and transitions delivery_status. openWorldHint=true because this involves external transmission; always call after a preview. / Mencatat metode/waktu/persetujuan e-delivery/id pesan pengiriman dan mentransisikan delivery_status. openWorldHint=true karena melibatkan transmisi eksternal; selalu panggil setelah preview.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        assertScope(context.principal, ["requester", "admin"]);

        await recordDelivery(context.db, {
          tenantId: context.principal.tenantId,
          principal: context.principal,
          requestId: context.requestId,
          documentId: args.documentId,
          deliveryStatus: args.deliveryStatus,
          method: args.method,
          messageId: args.messageId,
          electronicConsent: args.electronicConsent,
          deliveredAt: args.deliveredAt,
        });

        return toToolResult({
          operationId: randomUUID(),
          subjectId: args.documentId,
          subjectVersion: 1,
          status: args.deliveryStatus,
          missingFields: [],
          findings: [],
          evidenceRefs: [`assen://documents/${args.documentId}`],
          nextActions: args.deliveryStatus === "delivered" ? [] : ["交付結果を確認し、必要に応じて再送してください"],
        });
      } catch (error) {
        if (error instanceof UserInputError || error instanceof InvalidTransitionError) {
          return toToolErrorResult(error.message, error instanceof UserInputError ? error.remediation : undefined);
        }
        logMessage("error", "document.record_deliveryに失敗しました / document.record_delivery failed", {
          error: error instanceof Error ? error.message : String(error),
          requestId: context.requestId,
        });
        return toToolErrorResult("交付記録の登録に失敗しました / Failed to record delivery");
      }
    },
  );
}

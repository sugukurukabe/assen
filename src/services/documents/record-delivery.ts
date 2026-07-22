/**
 * document.record_deliveryの中核処理：交付記録（方法・日時・電子交付同意・メッセージID）を保存し、
 * delivery_statusを遷移させる
 * Core logic for document.record_delivery: records delivery metadata (method/time/e-delivery consent/message id) and
 * transitions delivery_status
 * Logika inti document.record_delivery: mencatat metadata pengiriman (metode/waktu/persetujuan e-delivery/id pesan) dan
 * mentransisikan delivery_status
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { documents } from "../../db/schema/documents.js";
import { assertDeliveryTransition } from "./state-machine.js";
import { appendAuditEvent } from "../../audit/hash-chain.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";

type Db = NodePgDatabase<typeof schema>;

export interface RecordDeliveryInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  documentId: string;
  deliveryStatus: "queued" | "sent" | "delivered" | "failed";
  method: string;
  messageId?: string;
  electronicConsent?: boolean;
  deliveredAt?: string;
}

export async function recordDelivery(db: Db, input: RecordDeliveryInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [document] = await tx.select().from(documents).where(eq(documents.id, input.documentId));
    if (!document) {
      throw new UserInputError(
        `document ${input.documentId} が見つかりません / document ${input.documentId} not found`,
        "documentIdを確認してください / Please verify documentId",
      );
    }

    assertDeliveryTransition(document.deliveryStatus, input.deliveryStatus);

    await tx
      .update(documents)
      .set({
        deliveryStatus: input.deliveryStatus,
        deliveryMeta: {
          method: input.method,
          messageId: input.messageId,
          electronicConsent: input.electronicConsent ?? false,
          deliveredAt: input.deliveredAt,
        },
      })
      .where(eq(documents.id, input.documentId));

    await appendAuditEvent(tx, {
      tenantId: input.tenantId,
      aggregateType: "document",
      aggregateId: document.id,
      aggregateVersion: document.version,
      eventType: `document.delivery_${input.deliveryStatus}`,
      afterHash: document.executedSha256 ?? document.generatedSha256 ?? "",
      principal: input.principal,
      requestId: input.requestId,
    });
  });
}

/**
 * placement.confirmed outboxイベントのSlack通知（成約＋随時届出案内＋請求ドラフト要約）
 * Slack notification for placement.confirmed (hire + ad-hoc filing guidance + invoice draft summary)
 * Notifikasi Slack untuk placement.confirmed (penempatan + panduan laporan wajib + ringkasan draf tagihan)
 */
import { z } from "zod";
import { postSlackMessage } from "../../../lib/slack-notifier.js";
import type { OutboxHandler } from "../worker.js";

const payloadSchema = z.object({
  jobOrderReferralId: z.string(),
  outcome: z.enum(["hired", "rejected"]),
  feeRecordId: z.string().optional(),
  reason: z.string().optional(),
  feeInvoiceDraft: z
    .object({
      title: z.string(),
      amountInclTax: z.number(),
      payerName: z.string(),
      hiredAt: z.string(),
      bodyText: z.string(),
    })
    .optional(),
  adHocFilingGuidance: z
    .object({
      sugukuruFiling: z.string(),
      receivingEmployerFiling: z.string(),
      deadlineDate: z.string(),
      eventDate: z.string(),
    })
    .optional(),
});

export const notifySlackOnPlacementConfirmed: OutboxHandler = async (event) => {
  const payload = payloadSchema.parse(event.payload);
  if (payload.outcome !== "hired") {
    await postSlackMessage({
      text: [
        "紹介結果: 不採用 / Placement outcome: rejected",
        `referral_id: ${payload.jobOrderReferralId}`,
        "⑧不採用理由の明示請求へ進んでください / Proceed to the ⑧ non-hire-reason request",
      ].join("\n"),
    });
    return;
  }

  const lines = [
    "✅ 成約（WF-25H相当） / Placement confirmed",
    `referral_id: ${payload.jobOrderReferralId}`,
    payload.feeRecordId ? `fee_record_id: ${payload.feeRecordId}` : undefined,
  ];
  if (payload.feeInvoiceDraft) {
    lines.push(
      `請求ドラフト: ${payload.feeInvoiceDraft.payerName} / ¥${payload.feeInvoiceDraft.amountInclTax.toLocaleString("ja-JP")} / 成約日 ${payload.feeInvoiceDraft.hiredAt}`,
    );
  }
  if (payload.adHocFilingGuidance) {
    lines.push(
      `随時届出: スグクル ${payload.adHocFilingGuidance.sugukuruFiling} ＋ 受入 ${payload.adHocFilingGuidance.receivingEmployerFiling}（期限 ${payload.adHocFilingGuidance.deadlineDate}）`,
    );
  }
  await postSlackMessage({ text: lines.filter(Boolean).join("\n") });
};

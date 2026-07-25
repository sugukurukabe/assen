/**
 * placement.confirmed outboxイベントのSlack通知（成約＋随時届出案内＋請求ドラフト要約）
 * Slack notification for placement.confirmed (hire + ad-hoc filing guidance + invoice draft summary)
 * Notifikasi Slack untuk placement.confirmed (penempatan + panduan laporan wajib + ringkasan draf tagihan)
 */
import { z } from "zod";
import { loadEnv } from "../../../lib/env.js";
import { postSlackMessage } from "../../../lib/slack-notifier.js";
import type { OutboxHandler } from "../worker.js";

const payloadSchema = z.object({
  jobOrderReferralId: z.string(),
  outcome: z.enum(["hired", "rejected"]),
  feeRecordId: z.string().optional(),
  reason: z.string().optional(),
  conversionType: z.enum(["t2p_conversion", "win_transition", "standard_placement_hire"]).optional(),
  feeStatus: z.enum(["billable", "pending_negotiation", "on_hold"]).optional(),
  feeInvoiceDraft: z
    .object({
      title: z.string(),
      amountInclTax: z.number().optional(),
      feeStatus: z.enum(["billable", "pending_negotiation", "on_hold"]).optional(),
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

function slackChannelOrThrow(value: string, name: string, nodeEnv: string): string {
  if (value) {
    return value;
  }
  if (nodeEnv === "production") {
    throw new Error(`${name} is required in production`);
  }
  return "";
}

export const notifySlackOnPlacementConfirmed: OutboxHandler = async (event) => {
  const payload = payloadSchema.parse(event.payload);
  const env = loadEnv();
  const kpiChannelId = slackChannelOrThrow(env.SLACK_KPI_CHANNEL_ID, "SLACK_KPI_CHANNEL_ID", env.NODE_ENV);
  if (payload.outcome !== "hired") {
    await postSlackMessage({
      channelId: kpiChannelId,
      text: [
        "紹介結果: 不採用 / Placement outcome: rejected",
        `referral_id: ${payload.jobOrderReferralId}`,
        "⑧不採用理由の明示請求へ進んでください / Proceed to the ⑧ non-hire-reason request",
      ].join("\n"),
    });
    return;
  }

  const placementLines = [
    "成約（WF-25H相当） / Placement confirmed",
    `referral_id: ${payload.jobOrderReferralId}`,
    payload.conversionType ? `転換種別: ${payload.conversionType}` : undefined,
    payload.feeRecordId ? `fee_record_id: ${payload.feeRecordId}` : undefined,
  ];
  if (payload.adHocFilingGuidance) {
    placementLines.push(
      `随時届出: スグクル ${payload.adHocFilingGuidance.sugukuruFiling} ＋ 受入 ${payload.adHocFilingGuidance.receivingEmployerFiling}（期限 ${payload.adHocFilingGuidance.deadlineDate}）`,
    );
  }
  await postSlackMessage({ text: placementLines.filter(Boolean).join("\n"), channelId: kpiChannelId });

  if (payload.feeInvoiceDraft) {
    const financeChannelId = slackChannelOrThrow(env.SLACK_FINANCE_CHANNEL_ID, "SLACK_FINANCE_CHANNEL_ID", env.NODE_ENV);
    const amount =
      payload.feeInvoiceDraft.amountInclTax === undefined
        ? "協議中・請求保留"
        : `¥${payload.feeInvoiceDraft.amountInclTax.toLocaleString("ja-JP")}`;
    await postSlackMessage({
      channelId: financeChannelId,
      text: [
        "請求ドラフト（WF-25H→#40） / Fee invoice draft",
        `referral_id: ${payload.jobOrderReferralId}`,
        payload.feeRecordId ? `fee_record_id: ${payload.feeRecordId}` : undefined,
        `請求先: ${payload.feeInvoiceDraft.payerName}`,
        `金額: ${amount}`,
        `手数料ステータス: ${payload.feeInvoiceDraft.feeStatus ?? payload.feeStatus ?? "billable"}`,
        "吉原さんの承認後にfreee登録へ進めてください / Proceed to freee only after Yoshihara approves",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
};

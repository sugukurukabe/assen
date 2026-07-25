/**
 * kpi.weekly_requested outboxイベント：週次5指標をSLACK_KPI_CHANNEL_IDへ投稿する
 * kpi.weekly_requested outbox event: posts the weekly 5 metrics to SLACK_KPI_CHANNEL_ID
 * Event outbox kpi.weekly_requested: posting 5 indikator mingguan ke SLACK_KPI_CHANNEL_ID
 */
import { z } from "zod";
import { loadEnv } from "../../../lib/env.js";
import { postSlackMessage } from "../../../lib/slack-notifier.js";
import type { OutboxHandler } from "../worker.js";

const payloadSchema = z.object({
  slackText: z.string(),
});

export const notifySlackOnWeeklyKpi: OutboxHandler = async (event) => {
  const payload = payloadSchema.parse(event.payload);
  const env = loadEnv();
  if (!env.SLACK_KPI_CHANNEL_ID) {
    if (env.NODE_ENV === "production") {
      throw new Error("SLACK_KPI_CHANNEL_ID is required in production");
    }
    // 未設定なら承認チャンネルへも送らず、postSlackMessageのログフォールバックに任せる
    // If unset, do not fall back to the approval channel; let postSlackMessage log-only
    await postSlackMessage({ text: payload.slackText, channelId: "" });
    return;
  }
  await postSlackMessage({ text: payload.slackText, channelId: env.SLACK_KPI_CHANNEL_ID });
};

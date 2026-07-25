/**
 * T2P期限作成イベントのSlack通知
 * Slack notification for created T2P deadlines
 * Notifikasi Slack untuk tenggat T2P yang dibuat
 */
import { z } from "zod";
import { loadEnv } from "../../../lib/env.js";
import { postSlackMessage } from "../../../lib/slack-notifier.js";
import type { OutboxHandler } from "../worker.js";

const payloadSchema = z.object({
  dispatchAssignmentId: z.string(),
  t2pDeadlines: z.array(z.object({ policyKey: z.string(), dueDate: z.string() })),
  reason: z.string().optional(),
});

const approachingPayloadSchema = z.object({
  deadlineInstanceId: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  policyKey: z.string(),
  dueDate: z.string(),
  daysBeforeDue: z.number(),
});

function kpiChannelOrThrow(channelId: string, nodeEnv: string): string {
  if (channelId) {
    return channelId;
  }
  if (nodeEnv === "production") {
    throw new Error("SLACK_KPI_CHANNEL_ID is required in production");
  }
  return "";
}

export const notifySlackOnT2pDeadlinesCreated: OutboxHandler = async (event) => {
  const payload = payloadSchema.parse(event.payload);
  const env = loadEnv();
  await postSlackMessage({
    channelId: kpiChannelOrThrow(env.SLACK_KPI_CHANNEL_ID, env.NODE_ENV),
    text: [
      "T2P期限を作成しました / T2P deadlines created",
      `dispatch_assignment_id: ${payload.dispatchAssignmentId}`,
      ...payload.t2pDeadlines.map((deadline) => `・${deadline.policyKey}: ${deadline.dueDate}`),
      "4ヶ月/5ヶ月は内部目標、6ヶ月は転換・終了の上限として管理してください。",
    ].join("\n"),
  });
};

export const notifySlackOnT2pDeadlineApproaching: OutboxHandler = async (event) => {
  const payload = approachingPayloadSchema.parse(event.payload);
  const env = loadEnv();
  await postSlackMessage({
    channelId: kpiChannelOrThrow(env.SLACK_KPI_CHANNEL_ID, env.NODE_ENV),
    text: [
      "T2P期限が近づいています / T2P deadline approaching",
      `policy_key: ${payload.policyKey}`,
      `${payload.subjectType}_id: ${payload.subjectId}`,
      `due_date: ${payload.dueDate}`,
      `days_before_due: ${payload.daysBeforeDue}`,
      "fulfilledAt済みの場合は通知対象外です。未完了なら#15で担当者を決めてください。",
    ].join("\n"),
  });
};

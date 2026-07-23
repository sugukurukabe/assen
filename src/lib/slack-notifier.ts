/**
 * Slack Web API（chat.postMessage）経由の通知クライアント。SLACK_BOT_TOKEN／SLACK_APPROVAL_CHANNEL_IDが
 * どちらも設定されている場合のみ実際に送信し、未設定ならログ出力のみに留める（ローカル開発・テストで
 * ネットワーク呼び出しやSlackアプリ作成を強制しないため）
 *
 * Notification client via the Slack Web API (chat.postMessage). Only actually posts when both
 * SLACK_BOT_TOKEN and SLACK_APPROVAL_CHANNEL_ID are set; otherwise logs instead (so local dev/tests never
 * require a network call or a Slack app to exist)
 *
 * Klien notifikasi via Slack Web API (chat.postMessage). Hanya benar-benar mengirim saat SLACK_BOT_TOKEN
 * dan SLACK_APPROVAL_CHANNEL_ID keduanya diatur; jika tidak, hanya mencatat log (agar dev/test lokal tidak
 * pernah memerlukan panggilan jaringan atau pembuatan Slack app)
 */
import { loadEnv } from "./env.js";
import { logMessage } from "./logger.js";

export interface SlackMessage {
  text: string;
}

interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
}

/**
 * Slack設定が両方揃っている場合はchat.postMessageで送信し、そうでなければログ出力に留める
 * Posts via chat.postMessage when both Slack settings are present; otherwise only logs
 * Mengirim via chat.postMessage saat kedua setelan Slack ada; jika tidak, hanya mencatat log
 */
export async function postSlackMessage(message: SlackMessage): Promise<void> {
  const env = loadEnv();
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_APPROVAL_CHANNEL_ID) {
    logMessage("info", "Slack未設定のため通知をログ出力のみに留めます / Slack not configured; logging instead of posting", {
      text: message.text,
    });
    return;
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel: env.SLACK_APPROVAL_CHANNEL_ID, text: message.text }),
  });

  const body = (await response.json()) as SlackPostMessageResponse;
  if (!response.ok || !body.ok) {
    throw new Error(`Slack chat.postMessageに失敗しました / Slack chat.postMessage failed: ${body.error ?? response.status}`);
  }
}

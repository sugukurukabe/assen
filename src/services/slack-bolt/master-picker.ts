/**
 * Slack Workflow用カスタムステップ：staff / partner / job_seeker をモーダルで選ばせる
 * Custom Slack Workflow step that lets users pick staff / partner / job_seeker in a modal
 * Custom step Workflow Slack yang memungkinkan pengguna memilih staff / partner / job_seeker di modal
 */
import type { App } from "@slack/bolt";
import { logMessage } from "../../lib/logger.js";
import type { AssenMcpClient, ListToolName } from "./assen-mcp-client.js";

type SlackChatClient = {
  chat: {
    postMessage: (args: {
      channel: string;
      text: string;
      blocks?: unknown[];
    }) => Promise<{ channel?: string; ts?: string }>;
    update: (args: {
      channel: string;
      ts: string;
      text: string;
      blocks?: unknown[];
    }) => Promise<unknown>;
  };
};

const FUNCTION_CALLBACK_ID = "pick_master_values";
const OPEN_PICKER_ACTION_ID = "open_master_picker";
const VIEW_CALLBACK_ID = "master_picker_submit";
const STAFF_ACTION_ID = "staff_select";
const PARTNER_ACTION_ID = "partner_select";
const JOB_SEEKER_ACTION_ID = "job_seeker_select";
const SLACK_LABEL_MAX = 75;

type ModalBlock =
  | {
      type: "input";
      block_id: string;
      optional: boolean;
      label: { type: "plain_text"; text: string };
      element: {
        type: "external_select";
        action_id: string;
        min_query_length: number;
        placeholder: { type: "plain_text"; text: string };
      };
    }
  | {
      type: "section";
      text: { type: "mrkdwn"; text: string };
    }
  | {
      type: "actions";
      elements: Array<{
        type: "button";
        action_id: string;
        text: { type: "plain_text"; text: string };
        value: string;
        style?: "primary";
      }>;
    };

interface PickerFlags {
  askStaff: boolean;
  askPartner: boolean;
  askJobSeeker: boolean;
  title: string;
  functionExecutionId: string;
  assignee: string;
  messageChannel: string;
  messageTs: string;
}

interface SelectionOutputs {
  staff_value: string;
  staff_label: string;
  partner_value: string;
  partner_label: string;
  job_seeker_value: string;
  job_seeker_label: string;
}

interface OptionBlockValue {
  value?: string;
  selected_option?: { value?: string; text?: { text?: string } };
}

function asBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return defaultValue;
}

function truncateLabel(label: string): string {
  if (label.length <= SLACK_LABEL_MAX) {
    return label;
  }
  return `${label.slice(0, SLACK_LABEL_MAX - 1)}…`;
}

/**
 * Slackのuser/channel入力をID文字列に正規化する
 * Normalize Slack user/channel inputs to an ID string
 * Menormalisasi input user/channel Slack menjadi string ID
 */
export function extractSlackId(raw: unknown): string {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    for (const key of ["id", "user_id", "channel_id"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
  }
  return "";
}

/**
 * 選択結果の表示文を組み立てる
 * Build the human-readable selection summary
 * Menyusun ringkasan pilihan yang terbaca manusia
 */
export function buildSelectionSummary(
  title: string,
  outputs: SelectionOutputs,
  flags: Pick<PickerFlags, "askStaff" | "askPartner" | "askJobSeeker">,
): string {
  const lines: string[] = [`*${title} — 選択完了*`];
  if (flags.askStaff) {
    lines.push(`• スタッフ: ${outputs.staff_label || "（未選択）"}`);
  }
  if (flags.askPartner) {
    lines.push(`• 取引先: ${outputs.partner_label || "（未選択）"}`);
  }
  if (flags.askJobSeeker) {
    lines.push(`• 求職者: ${outputs.job_seeker_label || "（未選択）"}`);
  }
  return lines.join("\n");
}

function parsePrivateMetadata(raw: string | undefined): PickerFlags {
  if (!raw) {
    throw new Error("private_metadata is missing");
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    askStaff: asBoolean(parsed.askStaff),
    askPartner: asBoolean(parsed.askPartner),
    askJobSeeker: asBoolean(parsed.askJobSeeker),
    title: typeof parsed.title === "string" && parsed.title.length > 0 ? parsed.title : "Assenマスタ選択",
    functionExecutionId:
      typeof parsed.functionExecutionId === "string" ? parsed.functionExecutionId : "",
    assignee: typeof parsed.assignee === "string" ? parsed.assignee : "",
    messageChannel: typeof parsed.messageChannel === "string" ? parsed.messageChannel : "",
    messageTs: typeof parsed.messageTs === "string" ? parsed.messageTs : "",
  };
}

function buildModal(flags: PickerFlags): {
  type: "modal";
  callback_id: string;
  private_metadata: string;
  title: { type: "plain_text"; text: string };
  submit: { type: "plain_text"; text: string };
  close: { type: "plain_text"; text: string };
  blocks: ModalBlock[];
} {
  const blocks: ModalBlock[] = [];
  if (flags.askStaff) {
    blocks.push({
      type: "input",
      block_id: "staff_block",
      optional: false,
      label: { type: "plain_text", text: "スタッフ" },
      element: {
        type: "external_select",
        action_id: STAFF_ACTION_ID,
        min_query_length: 0,
        placeholder: { type: "plain_text", text: "氏名・社員番号で検索" },
      },
    });
  }
  if (flags.askPartner) {
    blocks.push({
      type: "input",
      block_id: "partner_block",
      optional: false,
      label: { type: "plain_text", text: "取引先・派遣先" },
      element: {
        type: "external_select",
        action_id: PARTNER_ACTION_ID,
        min_query_length: 0,
        placeholder: { type: "plain_text", text: "会社名で検索" },
      },
    });
  }
  if (flags.askJobSeeker) {
    blocks.push({
      type: "input",
      block_id: "job_seeker_block",
      optional: false,
      label: { type: "plain_text", text: "求職者" },
      element: {
        type: "external_select",
        action_id: JOB_SEEKER_ACTION_ID,
        min_query_length: 0,
        placeholder: { type: "plain_text", text: "氏名で検索" },
      },
    });
  }

  return {
    type: "modal",
    callback_id: VIEW_CALLBACK_ID,
    private_metadata: JSON.stringify(flags),
    title: { type: "plain_text", text: truncateLabel(flags.title) },
    submit: { type: "plain_text", text: "確定" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks,
  };
}

function selectedOption(
  stateValues: Record<string, Record<string, OptionBlockValue | undefined>> | undefined,
  blockId: string,
  actionId: string,
): { value: string; label: string } {
  const raw = stateValues?.[blockId]?.[actionId]?.selected_option;
  return {
    value: raw?.value ?? "",
    label: raw?.text?.text ?? "",
  };
}

function actionIdToToolName(actionId: string): ListToolName | undefined {
  if (actionId === STAFF_ACTION_ID) {
    return "staff_list";
  }
  if (actionId === PARTNER_ACTION_ID) {
    return "partner_list";
  }
  if (actionId === JOB_SEEKER_ACTION_ID) {
    return "job_seeker_list";
  }
  return undefined;
}

function slackErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { error?: unknown } }).data;
    if (typeof data?.error === "string") {
      return data.error;
    }
  }
  return undefined;
}

/**
 * チャンネル投稿を試し、未参加などならDMへフォールバックする
 * Try posting to a channel; fall back to DM if the bot is not in the channel
 * Coba kirim ke channel; fallback ke DM jika bot belum di channel
 */
async function postPickerPrompt(
  client: SlackChatClient,
  args: {
    assignee: string;
    notifyChannel: string;
    title: string;
    flagsWithoutMessage: Omit<PickerFlags, "messageChannel" | "messageTs">;
  },
): Promise<{ channel: string; ts: string; usedChannel: boolean }> {
  const flagsForValue = {
    ...args.flagsWithoutMessage,
    messageChannel: "",
    messageTs: "",
  };
  const intro =
    args.notifyChannel.length > 0
      ? `<@${args.assignee}> *${args.title}*\n下のボタンからAssenの候補を選んでください。`
      : `*${args.title}*\nスタッフ・取引先・求職者の候補をAssenから検索して選びます。`;
  const blocks: ModalBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: intro },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: OPEN_PICKER_ACTION_ID,
          text: { type: "plain_text", text: "候補を選ぶ" },
          value: JSON.stringify(flagsForValue),
          style: "primary",
        },
      ],
    },
  ];

  const tryPost = async (channel: string) => {
    return client.chat.postMessage({
      channel,
      text: `${args.title}：下のボタンから候補を選んでください`,
      blocks,
    });
  };

  if (args.notifyChannel.length > 0) {
    try {
      const posted = await tryPost(args.notifyChannel);
      if (!posted.channel || !posted.ts) {
        throw new Error("chat.postMessage returned without channel/ts");
      }
      return { channel: posted.channel, ts: posted.ts, usedChannel: true };
    } catch (error) {
      const code = slackErrorCode(error);
      logMessage("warning", "notify_channelへの投稿に失敗したためDMへフォールバックします / channel post failed; falling back to DM", {
        notifyChannel: args.notifyChannel,
        code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const posted = await tryPost(args.assignee);
  if (!posted.channel || !posted.ts) {
    throw new Error("chat.postMessage to assignee returned without channel/ts");
  }
  return { channel: posted.channel, ts: posted.ts, usedChannel: false };
}

async function publishSelectionResult(
  client: SlackChatClient,
  flags: PickerFlags,
  outputs: SelectionOutputs,
): Promise<void> {
  const summary = buildSelectionSummary(flags.title, outputs, flags);
  if (flags.messageChannel && flags.messageTs) {
    await client.chat.update({
      channel: flags.messageChannel,
      ts: flags.messageTs,
      text: summary.replace(/\*/g, ""),
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: summary },
        },
      ],
    });
    return;
  }

  const fallbackChannel = flags.assignee || flags.messageChannel;
  if (!fallbackChannel) {
    return;
  }
  await client.chat.postMessage({
    channel: fallbackChannel,
    text: summary.replace(/\*/g, ""),
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: summary },
      },
    ],
  });
}

/**
 * pick_master_valuesカスタムステップとモーダル／optionsハンドラを登録する
 * Registers the pick_master_values custom step and its modal/options handlers
 * Mendaftarkan custom step pick_master_values serta handler modal/options-nya
 */
export function registerMasterPicker(app: App, mcpClient: AssenMcpClient): void {
  app.function(FUNCTION_CALLBACK_ID, async ({ client, inputs, fail, body }) => {
    try {
      logMessage("info", "pick_master_valuesを開始します / starting pick_master_values", {
        inputKeys: Object.keys(inputs ?? {}),
        assigneeType: typeof inputs?.assignee,
      });

      const inputRecord = (inputs ?? {}) as Record<string, unknown>;
      const assignee = extractSlackId(inputRecord.assignee);
      if (!assignee) {
        logMessage("warning", "assigneeが空のためfailします / failing because assignee is empty", {
          assigneeRaw: inputs?.assignee,
        });
        await fail({ error: "assignee（選択担当者）が必要です" });
        return;
      }

      const notifyChannel = extractSlackId(inputRecord.notify_channel);
      const askStaff = asBoolean(inputs.ask_staff, true);
      const askPartner = asBoolean(inputs.ask_partner, true);
      const askJobSeeker = asBoolean(inputs.ask_job_seeker, false);
      if (!askStaff && !askPartner && !askJobSeeker) {
        await fail({ error: "ask_staff / ask_partner / ask_job_seeker のいずれかを有効にしてください" });
        return;
      }

      const title =
        typeof inputs.title === "string" && inputs.title.trim().length > 0
          ? inputs.title.trim()
          : "Assenマスタ選択";

      const functionExecutionId =
        typeof (body as { event?: { function_execution_id?: string } }).event?.function_execution_id ===
        "string"
          ? (body as { event: { function_execution_id: string } }).event.function_execution_id
          : "";

      const flagsWithoutMessage: Omit<PickerFlags, "messageChannel" | "messageTs"> = {
        askStaff,
        askPartner,
        askJobSeeker,
        title,
        functionExecutionId,
        assignee,
      };

      const posted = await postPickerPrompt(client, {
        assignee,
        notifyChannel,
        title,
        flagsWithoutMessage,
      });

      // ボタンvalueにmessageChannel/tsを入れ直し、確定後のchat.updateで使えるようにする
      // Rewrite button value with messageChannel/ts so chat.update can run after submit
      // Tulis ulang value tombol dengan messageChannel/ts agar chat.update bisa jalan setelah submit
      const flags: PickerFlags = {
        ...flagsWithoutMessage,
        messageChannel: posted.channel,
        messageTs: posted.ts,
      };
      await client.chat.update({
        channel: posted.channel,
        ts: posted.ts,
        text: `${title}：下のボタンから候補を選んでください`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                notifyChannel.length > 0 && posted.usedChannel
                  ? `<@${assignee}> *${title}*\n下のボタンからAssenの候補を選んでください。`
                  : `*${title}*\nスタッフ・取引先・求職者の候補をAssenから検索して選びます。`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                action_id: OPEN_PICKER_ACTION_ID,
                text: { type: "plain_text", text: "候補を選ぶ" },
                value: JSON.stringify(flags),
                style: "primary",
              },
            ],
          },
        ],
      });

      logMessage("info", "候補選択メッセージを送信しました / sent master picker message", {
        assignee,
        notifyChannel: notifyChannel || undefined,
        channel: posted.channel,
        ts: posted.ts,
        usedChannel: posted.usedChannel,
        functionExecutionId,
      });
    } catch (error) {
      logMessage("error", "pick_master_valuesに失敗しました / pick_master_values failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await fail({
        error: `マスタ選択ステップの開始に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.action(OPEN_PICKER_ACTION_ID, async ({ ack, body, client, action }) => {
    // trigger_idはack前に確保する（3秒以内にviews.openする必要がある）
    // Capture trigger_id before ack (views.open must happen within 3 seconds)
    // Ambil trigger_id sebelum ack (views.open harus dalam 3 detik)
    const bodyRecord = body as unknown as Record<string, unknown>;
    const interactivity =
      typeof bodyRecord.interactivity === "object" && bodyRecord.interactivity !== null
        ? (bodyRecord.interactivity as Record<string, unknown>)
        : undefined;
    const triggerId =
      (typeof bodyRecord.trigger_id === "string" && bodyRecord.trigger_id.length > 0
        ? bodyRecord.trigger_id
        : undefined) ??
      (typeof interactivity?.interactivity_pointer === "string" &&
      interactivity.interactivity_pointer.length > 0
        ? interactivity.interactivity_pointer
        : undefined);
    await ack();
    try {
      if (!triggerId) {
        throw new Error("trigger_id is missing");
      }
      const value = "value" in action && typeof action.value === "string" ? action.value : "";
      const flags = parsePrivateMetadata(value);
      if (!flags.functionExecutionId) {
        const functionData = bodyRecord.function_data;
        if (typeof functionData === "object" && functionData !== null) {
          const executionId = (functionData as { execution_id?: unknown }).execution_id;
          if (typeof executionId === "string" && executionId.length > 0) {
            flags.functionExecutionId = executionId;
          }
        }
      }
      // クリック元メッセージのchannel/tsがまだ無い場合はbodyから補完する
      // Fill messageChannel/ts from the clicked message body when missing
      // Lengkapi messageChannel/ts dari body pesan yang diklik jika belum ada
      if (!flags.messageChannel || !flags.messageTs) {
        const channel = bodyRecord.channel;
        const message = bodyRecord.message;
        if (typeof channel === "object" && channel !== null) {
          const channelId = (channel as { id?: unknown }).id;
          if (typeof channelId === "string") {
            flags.messageChannel = channelId;
          }
        }
        if (typeof message === "object" && message !== null) {
          const ts = (message as { ts?: unknown }).ts;
          if (typeof ts === "string") {
            flags.messageTs = ts;
          }
        }
      }
      await client.views.open({
        trigger_id: triggerId,
        view: buildModal(flags),
      });
      logMessage("info", "マスタ選択モーダルを開きました / opened master picker modal");
    } catch (error) {
      logMessage("error", "マスタ選択モーダルを開けませんでした / failed to open master picker modal", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const optionHandler = async ({
    ack,
    options,
  }: {
    ack: (response: {
      options: Array<{ text: { type: "plain_text"; text: string }; value: string }>;
    }) => Promise<void>;
    options: { action_id?: string; value?: string };
  }): Promise<void> => {
    const toolName = actionIdToToolName(options.action_id ?? "");
    if (!toolName) {
      await ack({ options: [] });
      return;
    }
    try {
      const result = await mcpClient.callListTool(toolName, {
        query: options.value ?? "",
        limit: 100,
      });
      await ack({
        options: result.items.map((item) => ({
          text: { type: "plain_text" as const, text: truncateLabel(item.label) },
          value: item.value,
        })),
      });
    } catch (error) {
      logMessage("error", "external_select optionsの取得に失敗しました / failed to load external_select options", {
        toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Slackのoptions応答ではエラー文言をoptionsに載せられないため空配列でackし、ログに残す
      // Slack options responses cannot carry an error string, so ack with [] and keep the detail in logs
      // Respons options Slack tidak bisa membawa string error, jadi ack dengan [] dan simpan detail di log
      await ack({ options: [] });
    }
  };

  app.options(STAFF_ACTION_ID, optionHandler);
  app.options(PARTNER_ACTION_ID, optionHandler);
  app.options(JOB_SEEKER_ACTION_ID, optionHandler);

  app.view(VIEW_CALLBACK_ID, async ({ ack, view, client }) => {
    await ack();
    try {
      const flags = parsePrivateMetadata(view.private_metadata);
      const staff = flags.askStaff
        ? selectedOption(view.state.values as never, "staff_block", STAFF_ACTION_ID)
        : { value: "", label: "" };
      const partner = flags.askPartner
        ? selectedOption(view.state.values as never, "partner_block", PARTNER_ACTION_ID)
        : { value: "", label: "" };
      const jobSeeker = flags.askJobSeeker
        ? selectedOption(view.state.values as never, "job_seeker_block", JOB_SEEKER_ACTION_ID)
        : { value: "", label: "" };

      const outputs: SelectionOutputs = {
        staff_value: staff.value,
        staff_label: staff.label,
        partner_value: partner.value,
        partner_label: partner.label,
        job_seeker_value: jobSeeker.value,
        job_seeker_label: jobSeeker.label,
      };

      if (!flags.functionExecutionId) {
        throw new Error("function_execution_id is missing from private_metadata");
      }

      await client.functions.completeSuccess({
        function_execution_id: flags.functionExecutionId,
        outputs: { ...outputs },
      });

      try {
        await publishSelectionResult(client, flags, outputs);
      } catch (publishError) {
        // 完了自体は成功しているので、結果表示の失敗はログのみ
        // Function already completed; result display failures are log-only
        // Function sudah selesai; kegagalan tampilan hasil hanya dicatat di log
        logMessage("warning", "選択結果の表示更新に失敗しました / failed to publish selection result", {
          error: publishError instanceof Error ? publishError.message : String(publishError),
        });
      }

      logMessage("info", "マスタ選択を完了しました / completed master picker", {
        functionExecutionId: flags.functionExecutionId,
        partnerLabel: partner.label || undefined,
        staffLabel: staff.label || undefined,
        jobSeekerLabel: jobSeeker.label || undefined,
      });
    } catch (error) {
      logMessage("error", "マスタ選択の確定に失敗しました / failed to complete master picker", {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        const flags = parsePrivateMetadata(view.private_metadata);
        if (flags.functionExecutionId) {
          await client.functions.completeError({
            function_execution_id: flags.functionExecutionId,
            error: `マスタ選択の確定に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } catch (completeError) {
        logMessage("error", "functions.completeErrorにも失敗しました / functions.completeError also failed", {
          error: completeError instanceof Error ? completeError.message : String(completeError),
        });
      }
    }
  });
}

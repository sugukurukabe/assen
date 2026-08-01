/**
 * Slack Workflow用カスタムステップ：staff / partner / job_seeker をモーダルで選ばせる
 * Custom Slack Workflow step that lets users pick staff / partner / job_seeker in a modal
 * Custom step Workflow Slack yang memungkinkan pengguna memilih staff / partner / job_seeker di modal
 */
import type { App } from "@slack/bolt";
import { logMessage } from "../../lib/logger.js";
import type { AssenMcpClient, ListToolName } from "./assen-mcp-client.js";

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

/**
 * pick_master_valuesカスタムステップとモーダル／optionsハンドラを登録する
 * Registers the pick_master_values custom step and its modal/options handlers
 * Mendaftarkan custom step pick_master_values serta handler modal/options-nya
 */
function extractAssignee(inputs: Record<string, unknown>): string {
  const raw = inputs.assignee;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    if (typeof record.id === "string" && record.id.trim().length > 0) {
      return record.id.trim();
    }
    if (typeof record.user_id === "string" && record.user_id.trim().length > 0) {
      return record.user_id.trim();
    }
  }
  return "";
}

export function registerMasterPicker(app: App, mcpClient: AssenMcpClient): void {
  app.function(FUNCTION_CALLBACK_ID, async ({ client, inputs, fail, body }) => {
    try {
      logMessage("info", "pick_master_valuesを開始します / starting pick_master_values", {
        inputKeys: Object.keys(inputs ?? {}),
        assigneeType: typeof inputs?.assignee,
      });

      const assignee = extractAssignee((inputs ?? {}) as Record<string, unknown>);
      if (!assignee) {
        logMessage("warning", "assigneeが空のためfailします / failing because assignee is empty", {
          assigneeRaw: inputs?.assignee,
        });
        await fail({ error: "assignee（選択担当者）が必要です" });
        return;
      }

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

      const flags: PickerFlags = {
        askStaff,
        askPartner,
        askJobSeeker,
        title,
        functionExecutionId,
      };

      const posted = await client.chat.postMessage({
        channel: assignee,
        text: `${title}：下のボタンから候補を選んでください`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${title}*\nスタッフ・取引先・求職者の候補をAssenから検索して選びます。`,
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
        channel: posted.channel,
        ts: posted.ts,
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
    logMessage("info", "open_master_pickerアクションを受信 / received open_master_picker action", {
      bodyType: typeof bodyRecord.type === "string" ? bodyRecord.type : undefined,
      bodyKeys: Object.keys(bodyRecord).slice(0, 40),
      hasTriggerId: Boolean(triggerId),
      hasFunctionData: Boolean(bodyRecord.function_data),
      rawHasTriggerIdKey: Object.prototype.hasOwnProperty.call(bodyRecord, "trigger_id"),
    });
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

      const outputs = {
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
        outputs,
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

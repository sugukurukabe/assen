/**
 * 2段階インテーク（Stage 0問い合わせ → 正式申込セット → 候補者昇格）の中核
 * Core of two-stage intake (Stage 0 inquiry → formal application set → candidate promote)
 * Inti intake 2 tahap (inquiry Stage 0 → paket pendaftaran resmi → promote kandidat)
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { inquiries } from "../../db/schema/inquiries.js";
import { UserInputError } from "../../lib/errors.js";
import type { AuthenticatedPrincipal } from "../../lib/auth.js";
import { confirmJobSeeker, type ConfirmJobSeekerInput } from "../documents/confirm-job-seeker.js";

type Db = NodePgDatabase<typeof schema>;

export type ApplicationChannel =
  | "sugukuru_job"
  | "win_job"
  | "sns_application"
  | "other_agency"
  | "direct_referral"
  | "internal_conversion";

export interface DmAnswers {
  visaStatus?: string;
  visaExpiry?: string;
  residence?: string;
  workHistory?: string;
  japaneseLevel?: string;
  careerGoal?: string;
}

const AUTO_CLOSE_DAYS = 7;

/**
 * 流入元タグ。経路enum（6値）より細かい単位で広告を切り分けるために使う
 * Source tag: separates ad traffic at a finer grain than the 6-value channel enum
 * Tag sumber: memisahkan trafik iklan lebih rinci daripada enum channel (6 nilai)
 */
export const SOURCE_TAG_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const SOURCE_DETAIL_MAX_KEYS = 8;
const SOURCE_DETAIL_MAX_VALUE_LENGTH = 200;

export interface InquiryExtras {
  sourceTag?: string;
  sourceDetail?: Record<string, string>;
}

/**
 * 集計キーにするため小文字・記号のみへ正規化する。表記ゆれで経路が分裂すると分母が数えられなくなる
 * Normalizes to a groupable key; unnormalized variants would fragment the funnel denominator
 * Menormalkan menjadi kunci agregasi; variasi penulisan akan memecah penyebut funnel
 */
export function normalizeSourceTag(raw: string): string {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!SOURCE_TAG_PATTERN.test(normalized)) {
    throw new UserInputError(
      `sourceTag "${raw}" は使えません / sourceTag "${raw}" is not usable / sourceTag "${raw}" tidak dapat dipakai`,
      "英小文字・数字と _ . : - のみ、64文字以内にしてください（例: meta_lead_form） / Use lowercase letters, digits and _ . : - only, max 64 chars (e.g. meta_lead_form)",
    );
  }
  return normalized;
}

function buildExtras(
  existing: InquiryExtras | null | undefined,
  input: { sourceTag?: string; sourceDetail?: Record<string, string> },
): InquiryExtras | null {
  const next: InquiryExtras = { ...(existing ?? {}) };

  if (input.sourceTag !== undefined) {
    next.sourceTag = normalizeSourceTag(input.sourceTag);
  }

  if (input.sourceDetail !== undefined) {
    const entries = Object.entries(input.sourceDetail);
    if (entries.length > SOURCE_DETAIL_MAX_KEYS) {
      throw new UserInputError(
        `sourceDetailのキーは${SOURCE_DETAIL_MAX_KEYS}個までです / sourceDetail accepts at most ${SOURCE_DETAIL_MAX_KEYS} keys / sourceDetail menerima maksimal ${SOURCE_DETAIL_MAX_KEYS} kunci`,
        "広告セットID・キャンペーン名など、後で数えたいものだけ残してください / Keep only the values you will count later",
      );
    }
    for (const [key, value] of entries) {
      if (value.length > SOURCE_DETAIL_MAX_VALUE_LENGTH) {
        throw new UserInputError(
          `sourceDetail.${key} が長すぎます / sourceDetail.${key} is too long / sourceDetail.${key} terlalu panjang`,
          `${SOURCE_DETAIL_MAX_VALUE_LENGTH}文字以内にしてください / Keep it within ${SOURCE_DETAIL_MAX_VALUE_LENGTH} characters`,
        );
      }
    }
    next.sourceDetail = { ...(existing?.sourceDetail ?? {}), ...input.sourceDetail };
  }

  return Object.keys(next).length === 0 ? null : next;
}

function isDmComplete(answers: DmAnswers): boolean {
  return Boolean(
    answers.visaStatus?.trim() &&
      answers.visaExpiry?.trim() &&
      answers.residence?.trim() &&
      answers.workHistory?.trim() &&
      answers.japaneseLevel?.trim() &&
      answers.careerGoal?.trim(),
  );
}

function isApplicationSetComplete(row: {
  hasApplicationForm: boolean;
  hasResume: boolean;
  hasResidenceCard: boolean;
  hasQualificationDocs: boolean;
  wantsT2p: boolean;
  hasT2pPriorConsent: boolean;
}): boolean {
  const base =
    row.hasApplicationForm && row.hasResume && row.hasResidenceCard && row.hasQualificationDocs;
  if (!row.wantsT2p) {
    return base;
  }
  return base && row.hasT2pPriorConsent;
}

export interface RecordInquiryInput {
  tenantId: string;
  displayName: string;
  channel: ApplicationChannel;
  dmAnswers?: DmAnswers;
  notes?: string;
  sourceTag?: string;
  sourceDetail?: Record<string, string>;
}

export async function recordInquiry(db: Db, input: RecordInquiryInput) {
  const dmAnswers = input.dmAnswers ?? {};
  const dmComplete = isDmComplete(dmAnswers);
  const extras = buildExtras(null, input);
  const id = randomUUID();
  const now = new Date();

  await db.insert(inquiries).values({
    id,
    tenantId: input.tenantId,
    displayName: input.displayName,
    channel: input.channel,
    status: "open",
    dmAnswers,
    dmComplete,
    lastContactAt: now,
    notes: input.notes,
    extras,
  });

  return {
    inquiryId: id,
    dmComplete,
    sourceTag: extras?.sourceTag,
    status: "open" as const,
    nextActions: dmComplete
      ? ["正式申込セットを送付し、inquiry.updateでsetSent=trueにしてください / Send the formal application set and call inquiry.update with setSent=true"]
      : ["DM5問（在留資格と期限/居住地/職歴・分野/日本語/希望）の回答を揃えてください / Complete the 5 DM questions"],
  };
}

export interface UpdateInquiryInput {
  inquiryId: string;
  dmAnswers?: DmAnswers;
  setSent?: boolean;
  hasApplicationForm?: boolean;
  hasResume?: boolean;
  hasResidenceCard?: boolean;
  hasQualificationDocs?: boolean;
  hasT2pPriorConsent?: boolean;
  wantsT2p?: boolean;
  setReceivedAt?: string;
  notes?: string;
  sourceTag?: string;
  sourceDetail?: Record<string, string>;
  autoCloseStale?: boolean;
}

export async function updateInquiry(db: Db, input: UpdateInquiryInput) {
  const [existing] = await db.select().from(inquiries).where(eq(inquiries.id, input.inquiryId)).limit(1);
  if (!existing) {
    throw new UserInputError(
      `inquiry ${input.inquiryId} が見つかりません / inquiry ${input.inquiryId} not found`,
      "inquiryIdを確認してください / Please verify inquiryId",
    );
  }
  if (existing.status === "promoted" || existing.status === "closed") {
    throw new UserInputError(
      `inquiryは既に${existing.status}です / inquiry is already ${existing.status}`,
      "クローズ済み・昇格済みの問い合わせは更新できません / Closed or promoted inquiries cannot be updated",
    );
  }

  const dmAnswers = {
    ...(existing.dmAnswers as DmAnswers),
    ...(input.dmAnswers ?? {}),
  };
  const dmComplete = isDmComplete(dmAnswers);
  const extras = buildExtras(existing.extras as InquiryExtras | null, input);
  const now = new Date();

  let status = existing.status;
  if (input.setSent && status === "open") {
    if (!dmComplete) {
      throw new UserInputError(
        "DM5問が揃う前に正式申込セットを送付できません / Cannot send the application set before the 5 DM answers are complete",
        "dmAnswersをすべて埋めてからsetSent=trueにしてください / Fill all dmAnswers before setSent=true",
      );
    }
    status = "set_sent";
  }

  const next = {
    dmAnswers,
    dmComplete,
    hasApplicationForm: input.hasApplicationForm ?? existing.hasApplicationForm,
    hasResume: input.hasResume ?? existing.hasResume,
    hasResidenceCard: input.hasResidenceCard ?? existing.hasResidenceCard,
    hasQualificationDocs: input.hasQualificationDocs ?? existing.hasQualificationDocs,
    hasT2pPriorConsent: input.hasT2pPriorConsent ?? existing.hasT2pPriorConsent,
    wantsT2p: input.wantsT2p ?? existing.wantsT2p,
    setSentAt: input.setSent ? (existing.setSentAt ?? now) : existing.setSentAt,
    setReceivedAt: input.setReceivedAt ?? existing.setReceivedAt,
    lastContactAt: now,
    notes: input.notes ?? existing.notes,
    extras,
    status,
    updatedAt: now,
  };

  // 7日無応答の自動クローズ（set_sent後） / Auto-close after 7 days with no response (post set_sent) / Tutup otomatis 7 hari tanpa respons (setelah set_sent)
  if (input.autoCloseStale !== false && status === "set_sent" && next.setSentAt) {
    const deadline = new Date(next.setSentAt.getTime() + AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000);
    const setComplete = isApplicationSetComplete(next);
    if (!setComplete && now >= deadline) {
      await db
        .update(inquiries)
        .set({
          ...next,
          status: "closed",
          closedAt: now,
          closeReason: "no_response_7_days",
        })
        .where(eq(inquiries.id, input.inquiryId));
      return {
        inquiryId: input.inquiryId,
        status: "closed" as const,
        dmComplete,
        applicationSetComplete: false,
        autoClosed: true,
        nextActions: ["7日無応答のため自動クローズしました。追いかけません / Auto-closed after 7 days with no response; do not chase"],
      };
    }
  }

  await db.update(inquiries).set(next).where(eq(inquiries.id, input.inquiryId));

  const applicationSetComplete = isApplicationSetComplete(next);
  return {
    inquiryId: input.inquiryId,
    status: next.status,
    dmComplete,
    applicationSetComplete,
    sourceTag: extras?.sourceTag,
    autoClosed: false,
    nextActions: applicationSetComplete
      ? ["inquiry.promoteで候補者（帳簿②）へ昇格してください / Promote to candidate (Ledger #2) via inquiry.promote"]
      : next.status === "set_sent"
        ? ["正式申込セット（求職申込書・履歴書・在留カード両面・資格書類）の受領を待ってください / Wait for the formal application set"]
        : ["DM5問を揃えてから正式申込セットを送付してください / Complete DM answers, then send the application set"],
  };
}

export interface PromoteInquiryInput {
  tenantId: string;
  principal: AuthenticatedPrincipal;
  requestId: string;
  idempotencyKey: string;
  reason: string;
  inquiryId: string;
  seeker: ConfirmJobSeekerInput["seeker"];
  piiConsent: ConfirmJobSeekerInput["piiConsent"];
  fields: ConfirmJobSeekerInput["fields"];
}

export async function promoteInquiry(db: Db, input: PromoteInquiryInput) {
  const [existing] = await db.select().from(inquiries).where(eq(inquiries.id, input.inquiryId)).limit(1);
  if (!existing) {
    throw new UserInputError(
      `inquiry ${input.inquiryId} が見つかりません / inquiry ${input.inquiryId} not found`,
      "inquiryIdを確認してください / Please verify inquiryId",
    );
  }
  if (existing.status === "promoted" && existing.promotedJobSeekerId) {
    return {
      inquiryId: input.inquiryId,
      jobSeekerId: existing.promotedJobSeekerId,
      alreadyProcessed: true,
      applicationChannel: existing.channel,
    };
  }
  if (existing.status === "closed") {
    throw new UserInputError(
      "クローズ済みの問い合わせは昇格できません / Closed inquiries cannot be promoted",
      "必要なら新しいinquiry.recordからやり直してください / Start over with a new inquiry.record if needed",
    );
  }
  if (!isApplicationSetComplete(existing)) {
    throw new UserInputError(
      "正式申込セットが揃っていないため候補者に昇格できません / Cannot promote until the formal application set is complete",
      "inquiry.updateで書類受領フラグをすべてtrueにしてください（T2P希望者は事前同意書も必須） / Set all receipt flags true via inquiry.update (T2P also needs prior consent)",
    );
  }

  const acceptedAt = existing.setReceivedAt ?? input.fields.acceptedAt;
  const result = await confirmJobSeeker(db, {
    tenantId: input.tenantId,
    principal: input.principal,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    seeker: input.seeker,
    piiConsent: input.piiConsent,
    fields: { ...input.fields, acceptedAt },
  });

  // 受領日＝登録日＝帳簿②の求職受理日。経路も転記する
  // Receipt date = registration date = Ledger #2 acceptance date; also copy the channel
  await db
    .update(schema.jobSeekers)
    .set({
      applicationChannel: existing.channel,
      inquiryId: existing.id,
      acceptedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.jobSeekers.id, result.jobSeekerId));

  await db
    .update(inquiries)
    .set({
      status: "promoted",
      promotedJobSeekerId: result.jobSeekerId,
      setReceivedAt: acceptedAt,
      updatedAt: new Date(),
    })
    .where(eq(inquiries.id, input.inquiryId));

  return {
    inquiryId: input.inquiryId,
    jobSeekerId: result.jobSeekerId,
    alreadyProcessed: result.alreadyProcessed,
    applicationChannel: existing.channel,
    acceptedAt,
  };
}

/**
 * set_sentから7日経過しセット未完備の問い合わせを一括クローズする
 * Bulk-close set_sent inquiries older than 7 days without a complete set
 * Tutup massal inquiry set_sent >7 hari tanpa paket lengkap
 */
export async function closeStaleInquiries(db: Db, tenantId: string): Promise<{ closedCount: number }> {
  const deadline = new Date(Date.now() - AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000);
  const stale = await db
    .select()
    .from(inquiries)
    .where(
      and(
        eq(inquiries.tenantId, tenantId),
        eq(inquiries.status, "set_sent"),
        lt(inquiries.setSentAt, deadline),
      ),
    );

  let closedCount = 0;
  const now = new Date();
  for (const row of stale) {
    if (isApplicationSetComplete(row)) {
      continue;
    }
    await db
      .update(inquiries)
      .set({ status: "closed", closedAt: now, closeReason: "no_response_7_days", updatedAt: now })
      .where(eq(inquiries.id, row.id));
    closedCount += 1;
  }
  return { closedCount };
}

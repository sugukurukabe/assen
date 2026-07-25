/**
 * 週次5指標KPI集計（紹介ローンチ設計書§08）
 * Weekly 5-metric KPI aggregation (Placement Launch Spec §08)
 * Agregasi KPI 5 indikator mingguan (Spesifikasi Peluncuran §08)
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { feeRecords, jobOrderReferrals, jobSeekers } from "../../db/schema/ledgers.js";
import { inquiries } from "../../db/schema/inquiries.js";

type Db = NodePgDatabase<typeof schema>;

export interface WeeklyKpiInput {
  /** 週の開始日(YYYY-MM-DD、月曜想定)。省略時は直近7日 / Week start (YYYY-MM-DD, Monday). Defaults to last 7 days / Awal minggu. Default 7 hari terakhir */
  weekStart?: string;
  weekEnd?: string;
}

export interface WeeklyKpiSummary {
  period: { start: string; end: string };
  inquiries: number;
  applicationSetsSent: number;
  applicationSetsReceived: number;
  newCandidates: number;
  referrals: number;
  interviews: number;
  offers: number;
  placements: number;
  feeAmountInclTax: number;
  byChannel: Record<string, number>;
  inquiryByChannel: Record<string, number>;
  byBusinessFlag: Record<string, number>;
  channelFunnels: Record<
    string,
    {
      inquiries: number;
      applicationSetsSent: number;
      applicationSetsReceived: number;
      candidates: number;
      placements: number;
      inquiryToSetSent: number | null;
      setSentToReceived: number | null;
      setReceivedToCandidate: number | null;
      candidateToPlacement: number | null;
    }
  >;
  revenueByCategory: Record<
    string,
    {
      placements: number;
      confirmedFeeAmountInclTax: number;
      expectedRevenueMin: number;
      expectedRevenueMax: number;
    }
  >;
  ratios: {
    inquiryToSetSent: number | null;
    setSentToReceived: number | null;
    setReceivedToCandidate: number | null;
    referralToInterview: number | null;
    interviewToOffer: number | null;
    offerToPlacement: number | null;
  };
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 1000) / 1000;
}

export async function computeWeeklyKpi(db: Db, input: WeeklyKpiInput = {}): Promise<WeeklyKpiSummary> {
  const end = input.weekEnd ?? toDateOnly(new Date());
  const start = input.weekStart ?? addDays(end, -7);

  const [newCandidatesRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobSeekers)
    .where(and(gte(jobSeekers.acceptedAt, start), lt(jobSeekers.acceptedAt, addDays(end, 1))));

  const [inquiriesRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inquiries)
    .where(and(gte(inquiries.createdAt, new Date(`${start}T00:00:00.000Z`)), lt(inquiries.createdAt, new Date(`${addDays(end, 1)}T00:00:00.000Z`))));

  const [setsSentRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inquiries)
    .where(and(gte(inquiries.setSentAt, new Date(`${start}T00:00:00.000Z`)), lt(inquiries.setSentAt, new Date(`${addDays(end, 1)}T00:00:00.000Z`))));

  const [setsReceivedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inquiries)
    .where(and(gte(inquiries.setReceivedAt, start), lt(inquiries.setReceivedAt, addDays(end, 1))));

  const [referralsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobOrderReferrals)
    .where(and(gte(jobOrderReferrals.referredAt, start), lt(jobOrderReferrals.referredAt, addDays(end, 1))));

  const [interviewsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobOrderReferrals)
    .where(and(gte(jobOrderReferrals.interviewAt, start), lt(jobOrderReferrals.interviewAt, addDays(end, 1))));

  const [offersRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobOrderReferrals)
    .where(and(gte(jobOrderReferrals.offerAt, start), lt(jobOrderReferrals.offerAt, addDays(end, 1))));

  const [placementsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobOrderReferrals)
    .where(
      and(
        eq(jobOrderReferrals.outcome, "hired"),
        gte(jobOrderReferrals.hiredAt, start),
        lt(jobOrderReferrals.hiredAt, addDays(end, 1)),
      ),
    );

  const [feeRow] = await db
    .select({ total: sql<string>`coalesce(sum(${feeRecords.amountInclTax}), 0)` })
    .from(feeRecords)
    .innerJoin(jobOrderReferrals, eq(feeRecords.referralId, jobOrderReferrals.id))
    .where(
      and(
        eq(jobOrderReferrals.outcome, "hired"),
        gte(jobOrderReferrals.hiredAt, start),
        lt(jobOrderReferrals.hiredAt, addDays(end, 1)),
      ),
    );

  const channelRows = await db
    .select({
      channel: jobSeekers.applicationChannel,
      count: sql<number>`count(*)::int`,
    })
    .from(jobSeekers)
    .where(and(gte(jobSeekers.acceptedAt, start), lt(jobSeekers.acceptedAt, addDays(end, 1))))
    .groupBy(jobSeekers.applicationChannel);

  const byChannel: Record<string, number> = {};
  for (const row of channelRows) {
    byChannel[row.channel ?? "unknown"] = row.count;
  }

  const inquiryChannelRows = await db
    .select({
      channel: inquiries.channel,
      count: sql<number>`count(*)::int`,
    })
    .from(inquiries)
    .where(and(gte(inquiries.createdAt, new Date(`${start}T00:00:00.000Z`)), lt(inquiries.createdAt, new Date(`${addDays(end, 1)}T00:00:00.000Z`))))
    .groupBy(inquiries.channel);

  const inquiryByChannel: Record<string, number> = {};
  for (const row of inquiryChannelRows) {
    inquiryByChannel[row.channel] = row.count;
  }

  const businessRows = await db
    .select({
      businessFlag: jobSeekers.businessFlag,
      count: sql<number>`count(*)::int`,
    })
    .from(jobSeekers)
    .where(and(gte(jobSeekers.acceptedAt, start), lt(jobSeekers.acceptedAt, addDays(end, 1))))
    .groupBy(jobSeekers.businessFlag);

  const byBusinessFlag: Record<string, number> = {};
  for (const row of businessRows) {
    byBusinessFlag[row.businessFlag] = row.count;
  }

  const channelFunnelRows = await db
    .select({
      channel: inquiries.channel,
      inquiries: sql<number>`count(*)::int`,
      applicationSetsSent: sql<number>`count(${inquiries.setSentAt})::int`,
      applicationSetsReceived: sql<number>`count(${inquiries.setReceivedAt})::int`,
      candidates: sql<number>`count(${inquiries.promotedJobSeekerId})::int`,
    })
    .from(inquiries)
    .where(and(gte(inquiries.createdAt, new Date(`${start}T00:00:00.000Z`)), lt(inquiries.createdAt, new Date(`${addDays(end, 1)}T00:00:00.000Z`))))
    .groupBy(inquiries.channel);

  const placementChannelRows = await db
    .select({
      channel: jobSeekers.applicationChannel,
      placements: sql<number>`count(*)::int`,
    })
    .from(jobOrderReferrals)
    .innerJoin(jobSeekers, eq(jobOrderReferrals.jobSeekerId, jobSeekers.id))
    .where(and(eq(jobOrderReferrals.outcome, "hired"), gte(jobOrderReferrals.hiredAt, start), lt(jobOrderReferrals.hiredAt, addDays(end, 1))))
    .groupBy(jobSeekers.applicationChannel);

  const channelFunnels: WeeklyKpiSummary["channelFunnels"] = {};
  for (const row of channelFunnelRows) {
    const channel = row.channel;
    channelFunnels[channel] = {
      inquiries: row.inquiries,
      applicationSetsSent: row.applicationSetsSent,
      applicationSetsReceived: row.applicationSetsReceived,
      candidates: row.candidates,
      placements: 0,
      inquiryToSetSent: ratio(row.applicationSetsSent, row.inquiries),
      setSentToReceived: ratio(row.applicationSetsReceived, row.applicationSetsSent),
      setReceivedToCandidate: ratio(row.candidates, row.applicationSetsReceived),
      candidateToPlacement: null,
    };
  }
  for (const row of placementChannelRows) {
    const channel = row.channel ?? "unknown";
    const current =
      channelFunnels[channel] ??
      {
        inquiries: 0,
        applicationSetsSent: 0,
        applicationSetsReceived: 0,
        candidates: 0,
        placements: 0,
        inquiryToSetSent: null,
        setSentToReceived: null,
        setReceivedToCandidate: null,
        candidateToPlacement: null,
      };
    current.placements = row.placements;
    current.candidateToPlacement = ratio(row.placements, current.candidates);
    channelFunnels[channel] = current;
  }

  const revenueRows = await db
    .select({
      revenueCategory: jobOrderReferrals.revenueCategory,
      placements: sql<number>`count(distinct ${jobOrderReferrals.id})::int`,
      confirmedFeeAmountInclTax: sql<string>`coalesce(sum(${feeRecords.amountInclTax}) filter (where ${feeRecords.feeStatus} = 'billable'), 0)`,
      expectedRevenueMin: sql<string>`coalesce(sum(${jobOrderReferrals.expectedRevenueMin}), 0)`,
      expectedRevenueMax: sql<string>`coalesce(sum(${jobOrderReferrals.expectedRevenueMax}), 0)`,
    })
    .from(jobOrderReferrals)
    .leftJoin(feeRecords, eq(feeRecords.referralId, jobOrderReferrals.id))
    .where(and(eq(jobOrderReferrals.outcome, "hired"), gte(jobOrderReferrals.hiredAt, start), lt(jobOrderReferrals.hiredAt, addDays(end, 1))))
    .groupBy(jobOrderReferrals.revenueCategory);

  const revenueByCategory: WeeklyKpiSummary["revenueByCategory"] = {};
  for (const row of revenueRows) {
    const category = row.revenueCategory ?? "unknown";
    revenueByCategory[category] = {
      placements: row.placements,
      confirmedFeeAmountInclTax: Number(row.confirmedFeeAmountInclTax),
      expectedRevenueMin: Number(row.expectedRevenueMin),
      expectedRevenueMax: Number(row.expectedRevenueMax),
    };
  }

  const inquiryCount = inquiriesRow?.count ?? 0;
  const applicationSetsSent = setsSentRow?.count ?? 0;
  const applicationSetsReceived = setsReceivedRow?.count ?? 0;
  const newCandidates = newCandidatesRow?.count ?? 0;
  const referrals = referralsRow?.count ?? 0;
  const interviews = interviewsRow?.count ?? 0;
  const offers = offersRow?.count ?? 0;
  const placements = placementsRow?.count ?? 0;

  return {
    period: { start, end },
    inquiries: inquiryCount,
    applicationSetsSent,
    applicationSetsReceived,
    newCandidates,
    referrals,
    interviews,
    offers,
    placements,
    feeAmountInclTax: Number(feeRow?.total ?? 0),
    byChannel,
    inquiryByChannel,
    byBusinessFlag,
    channelFunnels,
    revenueByCategory,
    ratios: {
      inquiryToSetSent: ratio(applicationSetsSent, inquiryCount),
      setSentToReceived: ratio(applicationSetsReceived, applicationSetsSent),
      setReceivedToCandidate: ratio(newCandidates, applicationSetsReceived),
      referralToInterview: ratio(interviews, referrals),
      interviewToOffer: ratio(offers, interviews),
      offerToPlacement: ratio(placements, offers),
    },
  };
}

export function formatWeeklyKpiSlackText(summary: WeeklyKpiSummary): string {
  return [
    `週次KPI（${summary.period.start}〜${summary.period.end}）`,
    `・問い合わせ: ${summary.inquiries} / セット送付: ${summary.applicationSetsSent} / セット受領: ${summary.applicationSetsReceived}`,
    `・新規候補者: ${summary.newCandidates}`,
    `・推薦: ${summary.referrals}`,
    `・面接設定: ${summary.interviews}`,
    `・内定: ${summary.offers}`,
    `・成約: ${summary.placements}（手数料合計 ¥${summary.feeAmountInclTax.toLocaleString("ja-JP")}）`,
    `・成果区分別収益: ${JSON.stringify(summary.revenueByCategory)}`,
    `・経路別ファネル: ${JSON.stringify(summary.channelFunnels)}`,
    `・上流レシオ 問い合わせ→送付: ${summary.ratios.inquiryToSetSent ?? "—"} / 送付→受領: ${summary.ratios.setSentToReceived ?? "—"} / 受領→候補者: ${summary.ratios.setReceivedToCandidate ?? "—"}`,
    `・レシオ 推薦→面接: ${summary.ratios.referralToInterview ?? "—"} / 面接→内定: ${summary.ratios.interviewToOffer ?? "—"} / 内定→成約: ${summary.ratios.offerToPlacement ?? "—"}`,
  ].join("\n");
}

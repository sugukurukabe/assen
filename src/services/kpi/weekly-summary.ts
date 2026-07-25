/**
 * 週次5指標KPI集計（紹介ローンチ設計書§08）
 * Weekly 5-metric KPI aggregation (Placement Launch Spec §08)
 * Agregasi KPI 5 indikator mingguan (Spesifikasi Peluncuran §08)
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { feeRecords, jobOrderReferrals, jobSeekers } from "../../db/schema/ledgers.js";

type Db = NodePgDatabase<typeof schema>;

export interface WeeklyKpiInput {
  /** 週の開始日(YYYY-MM-DD、月曜想定)。省略時は直近7日 / Week start (YYYY-MM-DD, Monday). Defaults to last 7 days / Awal minggu. Default 7 hari terakhir */
  weekStart?: string;
  weekEnd?: string;
}

export interface WeeklyKpiSummary {
  period: { start: string; end: string };
  newCandidates: number;
  referrals: number;
  interviews: number;
  offers: number;
  placements: number;
  feeAmountInclTax: number;
  byChannel: Record<string, number>;
  ratios: {
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

  const newCandidates = newCandidatesRow?.count ?? 0;
  const referrals = referralsRow?.count ?? 0;
  const interviews = interviewsRow?.count ?? 0;
  const offers = offersRow?.count ?? 0;
  const placements = placementsRow?.count ?? 0;

  return {
    period: { start, end },
    newCandidates,
    referrals,
    interviews,
    offers,
    placements,
    feeAmountInclTax: Number(feeRow?.total ?? 0),
    byChannel,
    ratios: {
      referralToInterview: ratio(interviews, referrals),
      interviewToOffer: ratio(offers, interviews),
      offerToPlacement: ratio(placements, offers),
    },
  };
}

export function formatWeeklyKpiSlackText(summary: WeeklyKpiSummary): string {
  return [
    `📊 週次5指標（${summary.period.start}〜${summary.period.end}）`,
    `・新規候補者: ${summary.newCandidates}`,
    `・推薦: ${summary.referrals}`,
    `・面接設定: ${summary.interviews}`,
    `・内定: ${summary.offers}`,
    `・成約: ${summary.placements}（手数料合計 ¥${summary.feeAmountInclTax.toLocaleString("ja-JP")}）`,
    `・レシオ 推薦→面接: ${summary.ratios.referralToInterview ?? "—"} / 面接→内定: ${summary.ratios.interviewToOffer ?? "—"} / 内定→成約: ${summary.ratios.offerToPlacement ?? "—"}`,
  ].join("\n");
}

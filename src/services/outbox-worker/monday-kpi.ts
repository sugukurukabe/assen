/**
 * 月曜朝の週次KPI自動集計→outbox投入（workerから呼び出す）
 * Monday-morning weekly KPI aggregation → enqueue outbox (called from the worker)
 * Agregasi KPI mingguan Senin pagi → enqueue outbox (dipanggil dari worker)
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { tenantSettings } from "../../db/schema/tenant.js";
import { acquireTenantScopedDb } from "../../db/client.js";
import { enqueueOutboxEvent } from "./enqueue.js";
import { computeWeeklyKpi, formatWeeklyKpiSlackText } from "../kpi/weekly-summary.js";
import { logMessage } from "../../lib/logger.js";
import { loadEnv } from "../../lib/env.js";

type Db = NodePgDatabase<typeof schema>;

/**
 * 今日が月曜（UTC）かつSLACK_KPI_CHANNEL_ID設定時のみ、各テナントの週次KPIをoutboxへ積む
 * Only on Monday (UTC) and when SLACK_KPI_CHANNEL_ID is set, enqueue weekly KPI per tenant
 * Hanya pada Senin (UTC) dan saat SLACK_KPI_CHANNEL_ID diatur, enqueue KPI mingguan per tenant
 */
export async function enqueueMondayWeeklyKpiIfDue(db: Db): Promise<{ enqueued: number }> {
  const env = loadEnv();
  if (!env.SLACK_KPI_CHANNEL_ID) {
    return { enqueued: 0 };
  }

  const now = new Date();
  // 月曜 = getUTCDay() === 1。朝の窓 00:00–01:00 UTC に一度だけ積む（idempotency_keyで重複防止）
  // Monday = getUTCDay() === 1. Enqueue once in the 00:00–01:00 UTC window (idempotency_key prevents dupes)
  if (now.getUTCDay() !== 1 || now.getUTCHours() > 0) {
    return { enqueued: 0 };
  }

  const weekKey = now.toISOString().slice(0, 10);
  const tenants = await db.select({ tenantId: tenantSettings.tenantId }).from(tenantSettings);
  let enqueued = 0;

  for (const tenant of tenants) {
    const scoped = await acquireTenantScopedDb(tenant.tenantId);
    try {
      const summary = await computeWeeklyKpi(scoped.db, {});
      const slackText = formatWeeklyKpiSlackText(summary);
      await scoped.db.transaction(async (tx) => {
        await enqueueOutboxEvent(tx, {
          tenantId: tenant.tenantId,
          aggregateType: "kpi",
          aggregateId: weekKey,
          eventType: "kpi.weekly_requested",
          payload: { slackText, summary },
          idempotencyKey: `kpi.weekly:${tenant.tenantId}:${weekKey}`,
          externalReference: weekKey,
        });
      });
      enqueued += 1;
    } catch (error) {
      logMessage("error", "月曜KPIのenqueueに失敗しました / Failed to enqueue Monday KPI", {
        tenantId: tenant.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      scoped.release();
    }
  }

  return { enqueued };
}

/**
 * 日次メンテナンス：T2P期限接近通知とStage 0自動クローズをtenantごとに実行する
 * Daily maintenance: enqueue T2P deadline reminders and auto-close stale Stage 0 inquiries per tenant
 * Pemeliharaan harian: antrekan pengingat tenggat T2P dan tutup otomatis inquiry Stage 0 per tenant
 */
import { and, gte, isNull, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema/index.js";
import { acquireTenantScopedDb } from "../../db/client.js";
import { deadlineInstances } from "../../db/schema/legal.js";
import { tenantSettings } from "../../db/schema/tenant.js";
import { closeStaleInquiries } from "../inquiries/inquiry-lifecycle.js";
import { enqueueOutboxEvent } from "./enqueue.js";
import { logMessage } from "../../lib/logger.js";

type Db = NodePgDatabase<typeof schema>;

const DEADLINE_REMINDER_DAYS = new Set([30, 14, 7, 1]);

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

export async function enqueueDailyMaintenance(db: Db): Promise<{ deadlineReminders: number; staleInquiriesClosed: number }> {
  const today = toIsoDate(new Date());
  const maxDueDate = addDays(today, 30);
  const tenants = await db.select({ tenantId: tenantSettings.tenantId }).from(tenantSettings);
  let deadlineReminders = 0;
  let staleInquiriesClosed = 0;

  for (const tenant of tenants) {
    const scoped = await acquireTenantScopedDb(tenant.tenantId);
    try {
      const closeResult = await closeStaleInquiries(scoped.db, tenant.tenantId);
      staleInquiriesClosed += closeResult.closedCount;

      const upcoming = await scoped.db
        .select()
        .from(deadlineInstances)
        .where(and(isNull(deadlineInstances.fulfilledAt), gte(deadlineInstances.dueDate, today), lte(deadlineInstances.dueDate, maxDueDate)));

      for (const deadline of upcoming) {
        const daysBeforeDue = daysBetween(today, deadline.dueDate);
        if (!DEADLINE_REMINDER_DAYS.has(daysBeforeDue)) {
          continue;
        }
        await scoped.db.transaction(async (tx) => {
          await enqueueOutboxEvent(tx, {
            tenantId: tenant.tenantId,
            aggregateType: "deadline_instance",
            aggregateId: deadline.id,
            eventType: "t2p.deadline_approaching",
            payload: {
              deadlineInstanceId: deadline.id,
              subjectType: deadline.subjectType,
              subjectId: deadline.subjectId,
              policyKey: deadline.policyKey,
              dueDate: deadline.dueDate,
              daysBeforeDue,
            },
            idempotencyKey: `t2p.deadline_approaching:${tenant.tenantId}:${deadline.id}:${daysBeforeDue}:${today}`,
            externalReference: deadline.id,
          });
        });
        deadlineReminders += 1;
      }
    } catch (error) {
      logMessage("error", "日次メンテナンスに失敗しました / daily maintenance failed", {
        tenantId: tenant.tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      scoped.release();
    }
  }

  return { deadlineReminders, staleInquiriesClosed };
}

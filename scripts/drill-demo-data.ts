/**
 * バックアップ復元ドリル（scripts/db-restore-drill.sh）用のデモデータseed/cleanup。
 * 空のテーブルだけでは行数一致確認や監査チェーン検証が自明になってしまうため、実際のドメインフロー
 * （job_order.analyze→confirm）を1件走らせ、複数テーブル・複数audit_eventsを持つ意味のあるデータを作る。
 * ドリル終了後は必ずcleanupを呼び、常駐データを残さない
 *
 * Seeds/cleans up demo data for the backup-restore drill (scripts/db-restore-drill.sh). Empty tables would make
 * row-count comparisons and hash-chain verification trivially vacuous, so this runs one real domain flow
 * (job_order.analyze→confirm) to produce meaningful data spanning multiple tables and audit_events. Always call
 * cleanup after the drill so no demo data lingers
 *
 * Seed/cleanup data demo untuk drill restore backup (scripts/db-restore-drill.sh). Tabel kosong akan membuat
 * perbandingan jumlah baris dan verifikasi rantai hash menjadi trivial, jadi ini menjalankan satu alur domain
 * sungguhan (job_order.analyze→confirm) untuk menghasilkan data yang bermakna di beberapa tabel dan audit_events.
 * Selalu panggil cleanup setelah drill agar tidak ada data demo yang tersisa
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { acquireTenantScopedDb, getPool } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/audit.js";
import { jobOrders } from "../src/db/schema/ledgers.js";
import { sourceArtifacts, factAssertions } from "../src/db/schema/evidence.js";
import { analyzeJobOrder } from "../src/services/extraction/analyze-job-order.js";
import { confirmJobOrder } from "../src/services/documents/confirm-job-order.js";
import { logMessage } from "../src/lib/logger.js";
import { getPrivilegedDb, closePrivilegedDb } from "../test/helpers/privileged-db.js";
import type { AuthenticatedPrincipal } from "../src/lib/auth.js";

// ドリル間で毎回同一のテナントIDを使い、cleanupが確実に対象を特定できるようにする
// Uses the same fixed tenant id across drill runs so cleanup can reliably target it
// Menggunakan tenant id tetap yang sama di setiap run drill agar cleanup dapat menargetkan dengan andal
const DRILL_TENANT_ID = "00000000-0000-0000-0000-0000000d5111";

const principal: AuthenticatedPrincipal = {
  principalId: "drill-seed-principal",
  role: "admin",
  authMethod: "local_fixed_token",
  tenantId: DRILL_TENANT_ID,
};

const DEMO_JOB_ORDER_EMAIL = [
  "件名: 求人のご依頼（バックアップ復元ドリル用ダミーデータ）",
  "事業所名: 農業生産法人ドリル園",
  "所在地: 鹿児島県霧島市国分中央9-9-9",
  "代表者: 訓練太郎",
  "担当者: 訓練花子",
  "職種：農作業員（施設園芸）",
  "就業場所：鹿児島県霧島市",
  "求人数：1名",
  "雇用形態：有期",
  "賃金：時給1100円",
  "有効期限：2026-12-31",
].join("\n");

async function seed(): Promise<void> {
  const tenantScoped = await acquireTenantScopedDb(DRILL_TENANT_ID);
  try {
    const analysis = await analyzeJobOrder(tenantScoped.db, {
      tenantId: DRILL_TENANT_ID,
      sourceText: DEMO_JOB_ORDER_EMAIL,
      sourceUri: "drill://backup-restore-demo",
    });

    await confirmJobOrder(tenantScoped.db, {
      tenantId: DRILL_TENANT_ID,
      principal,
      requestId: randomUUID(),
      idempotencyKey: `drill-seed-${randomUUID()}`,
      reason: "バックアップ復元ドリル用のデモデータseed",
      sourceArtifactId: analysis.sourceArtifactId,
      employer: {
        companyId: randomUUID(),
        name: "農業生産法人ドリル園",
        address: "鹿児島県霧島市国分中央9-9-9",
        representative: "訓練太郎",
        contactPerson: "訓練花子",
      },
      fields: {
        acceptedAt: "2026-07-01",
        validUntil: "2026-12-31",
        headcount: 1,
        occupation: "農作業員（施設園芸）",
        workLocation: "鹿児島県霧島市",
        employmentPeriodType: "fixed",
        employmentPeriodDetail: "2026-07-01から2026-12-31までの期間契約",
        wageAmountMin: 1100,
        wageAmountMax: 1100,
        wageUnit: "hour",
        t2pFlag: false,
        refundSystem: false,
        source: "direct",
      },
    });

    logMessage("info", "ドリル用デモデータをseedしました / seeded drill demo data", { tenantId: DRILL_TENANT_ID });
  } finally {
    tenantScoped.release();
  }
}

async function cleanup(): Promise<void> {
  const privilegedDb = getPrivilegedDb();
  await privilegedDb.delete(jobOrders).where(eq(jobOrders.tenantId, DRILL_TENANT_ID));
  await privilegedDb.delete(factAssertions).where(eq(factAssertions.tenantId, DRILL_TENANT_ID));
  await privilegedDb.delete(sourceArtifacts).where(eq(sourceArtifacts.tenantId, DRILL_TENANT_ID));
  await privilegedDb.delete(auditEvents).where(eq(auditEvents.tenantId, DRILL_TENANT_ID));
  await closePrivilegedDb();
  logMessage("info", "ドリル用デモデータをcleanupしました / cleaned up drill demo data", { tenantId: DRILL_TENANT_ID });
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "seed") {
    await seed();
  } else if (mode === "cleanup") {
    await cleanup();
  } else {
    throw new Error("使い方: tsx scripts/drill-demo-data.ts <seed|cleanup> / Usage: tsx scripts/drill-demo-data.ts <seed|cleanup>");
  }
  await getPool().end();
}

main().catch((error: unknown) => {
  logMessage("critical", "drill-demo-dataの実行に失敗しました / drill-demo-data run failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

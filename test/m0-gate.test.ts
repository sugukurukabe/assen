/**
 * M0ゲート検証（§11 Done条件）：
 *   1) 全法定項目がDB列・証拠・出力欄へ100%マッピングされている（機械検査）
 *   2) 匿名化実例（あずま園型：鹿児島の農業人材派遣を想定した架空事業所）で一連の処理が再現できる
 *   3) 監査イベントのチェーン検証が通る
 * M0 gate verification (design doc §11 Done条件):
 *   1) Every legal item maps 100% to a DB column/evidence/output field (mechanical check)
 *   2) An anonymized example (あずま園-type: a fictional agricultural-dispatch employer in Kagoshima) reproduces end-to-end
 *   3) The audit-event chain verification passes
 * Verifikasi gate M0 (Done条件 §11 dokumen desain):
 *   1) Setiap item hukum termapping 100% ke kolom DB/evidence/output field (pemeriksaan mekanis)
 *   2) Contoh anonim (tipe あずま園: pemberi kerja dispatch pertanian fiktif di Kagoshima) dapat direproduksi end-to-end
 *   3) Verifikasi rantai audit-event lolos
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acquireTenantScopedDb, getPool, type TenantScopedDb } from "../src/db/client.js";
import { auditEvents } from "../src/db/schema/audit.js";
import { closePrivilegedDb, getPrivilegedDb } from "./helpers/privileged-db.js";
import { jobOrders } from "../src/db/schema/ledgers.js";
import { sourceArtifacts, factAssertions } from "../src/db/schema/evidence.js";
import { verifyChain } from "../src/audit/hash-chain.js";
import { analyzeJobOrder } from "../src/services/extraction/analyze-job-order.js";
import { confirmJobOrder } from "../src/services/documents/confirm-job-order.js";
import { evaluateSubjectCompliance } from "../src/services/rules/evaluate-subject.js";
import { loadMapping } from "../src/services/rules/legal-mapping-loader.js";
import type { AuthenticatedPrincipal } from "../src/lib/auth.js";

const principal: AuthenticatedPrincipal = {
  principalId: "m0-gate-test-principal",
  role: "admin",
  authMethod: "local_fixed_token",
  tenantId: "m0-gate-tenant",
};

// 匿名化実例（あずま園型）：鹿児島の農業法人からの純紹介求人メールを想定した架空データ
// Anonymized example (あずま園 type): fictional data modeling a pure-referral job-order email from a Kagoshima agricultural corporation
// Contoh anonim (tipe あずま園): data fiktif yang memodelkan email lowongan rujukan murni dari korporasi pertanian Kagoshima
const ANONYMIZED_JOB_ORDER_EMAIL = [
  "件名: 求人のご依頼（農作業スタッフ）",
  "事業所名: 農業生産法人あずま園",
  "所在地: 鹿児島県霧島市国分中央1-2-3",
  "代表者: 東山一郎",
  "担当者: 東山花子",
  "受付年月日: 2026-06-01",
  "有効期間: 2026-11-30",
  "求人数: 2",
  "職種: 農作業員（施設園芸）",
  "就業場所: 鹿児島県霧島市",
  "雇用形態: 期間の定めあり",
  "賃金: 時給1150円",
].join("\n");

let tenantId: string;
// RLSを実効性あるものとして検証するため、本番と同じacquireTenantScopedDbを使う（詳細はaudit-chain.test.ts参照）
// Uses acquireTenantScopedDb, the same mechanism production uses, so RLS is genuinely exercised (see audit-chain.test.ts)
// Menggunakan acquireTenantScopedDb, mekanisme yang sama dengan produksi, sehingga RLS benar-benar diuji (lihat audit-chain.test.ts)
let tenantScoped: TenantScopedDb;
let db: TenantScopedDb["db"];

beforeAll(async () => {
  tenantId = randomUUID();
  tenantScoped = await acquireTenantScopedDb(tenantId);
  db = tenantScoped.db;
});

afterAll(async () => {
  await db.delete(jobOrders).where(eq(jobOrders.tenantId, tenantId));
  await db.delete(factAssertions).where(eq(factAssertions.tenantId, tenantId));
  await db.delete(sourceArtifacts).where(eq(sourceArtifacts.tenantId, tenantId));
  // audit_eventsはruntimeロールからDELETEを剥奪しているため、後始末はsuperuser相当の接続で行う
  // audit_events has DELETE revoked from the runtime role, so cleanup uses the superuser-equivalent connection
  await getPrivilegedDb().delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
  tenantScoped.release();
  await getPool().end();
  await closePrivilegedDb();
});

describe("M0ゲート: 法定項目マッピング100% / M0 gate: 100% legal-item mapping", () => {
  it("job-order-ledger.jsonの全項目がoptionalでない限りdbColumnを持つ / every non-optional item declares a dbColumn", () => {
    const mapping = loadMapping("job-order-ledger.json");
    expect(mapping.items.length).toBeGreaterThan(0);
    for (const item of mapping.items) {
      expect(item.dbColumn).toBeTruthy();
      expect(item.outputField).toBeTruthy();
    }
  });

  it("labor-conditions-notice.jsonの全項目がconditionsTyped配下にマッピングされている / every item maps under conditionsTyped", () => {
    const mapping = loadMapping("labor-conditions-notice.json");
    for (const item of mapping.items) {
      expect(item.dbColumn.startsWith("conditionsTyped.")).toBe(true);
    }
  });
});

describe("M0ゲート: 匿名化実例（あずま園型）の再現 / M0 gate: reproducing the anonymized example", () => {
  it("求人メール→analyze→人間確認→confirm→評価の一連が再現できる / the intake-to-evaluation pipeline reproduces end-to-end", async () => {
    const analysis = await analyzeJobOrder(db, {
      tenantId,
      sourceText: ANONYMIZED_JOB_ORDER_EMAIL,
      sourceUri: "test://anonymized/azuma-en-001",
    });

    expect(analysis.sourceArtifactId).toBeTruthy();
    expect(analysis.facts.length).toBeGreaterThan(0);

    const confirmation = await confirmJobOrder(db, {
      tenantId,
      principal,
      requestId: randomUUID(),
      idempotencyKey: `m0-gate-${randomUUID()}`,
      reason: "M0ゲート検証（匿名化実例の再現）",
      sourceArtifactId: analysis.sourceArtifactId,
      employer: {
        companyId: randomUUID(),
        name: "農業生産法人あずま園",
        address: "鹿児島県霧島市国分中央1-2-3",
        representative: "東山一郎",
        contactPerson: "東山花子",
      },
      fields: {
        acceptedAt: "2026-06-01",
        validUntil: "2026-11-30",
        headcount: 2,
        occupation: "農作業員（施設園芸）",
        workLocation: "鹿児島県霧島市",
        employmentPeriodType: "fixed",
        employmentPeriodDetail: "2026-06-01から2026-11-30までの期間契約",
        wageAmountMin: 1150,
        wageAmountMax: 1150,
        wageUnit: "hour",
        t2pFlag: false,
        refundSystem: false,
        source: "direct",
      },
    });

    expect(confirmation.alreadyProcessed).toBe(false);

    const [jobOrderRow] = await db.select().from(jobOrders).where(eq(jobOrders.id, confirmation.jobOrderId));
    expect(jobOrderRow).toBeDefined();

    const findings = await evaluateSubjectCompliance(db, {
      tenantId,
      subjectType: "job_order",
      subjectId: confirmation.jobOrderId,
      mappingFileName: "job-order-ledger.json",
      row: jobOrderRow as unknown as Record<string, unknown>,
    });

    // retentionUntil（完結日から2年）は完結前は未確定であるため、この時点でのincompleteは仕様通り
    // retentionUntil (2 years from completion) is legitimately unset before completion, so "incomplete" here is expected by design
    // retentionUntil (2 tahun dari penyelesaian) secara sah belum ditetapkan sebelum penyelesaian, jadi "incomplete" di sini sesuai desain
    const requiredFieldsFinding = findings.find((finding) => finding.ruleKey === "job_order_ledger.required_fields");
    expect(requiredFieldsFinding?.missingFields).toEqual(["retentionUntil"]);
  });

  it("監査イベントのチェーン検証が通る / audit-event chain verification passes", async () => {
    const problems = await verifyChain(db, tenantId);
    expect(problems).toEqual([]);
  });
});

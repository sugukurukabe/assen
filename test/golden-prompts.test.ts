/**
 * golden promptハーネスの配線テスト（設計書§12・M3ゲート「golden promptテスト」の下準備）。
 *
 * ⚠️このテストはheuristicToolSelector（決定論的スタブ）を使ってフィクスチャ読込・実カタログ取得・正誤判定・
 * カテゴリ別集計というハーネスの配線が壊れていないことだけを検証する。「モデルが正しいツール列を選ぶ」という
 * M3ゲート本来の検証（実LLM・プロバイダ決定・より大きなフィクスチャ集合が必要）はまだ完了していない
 * （docs/registry-readiness-checklist.md D節参照）
 *
 * Wiring test for the golden-prompt harness (design doc §12; groundwork for M3 gate item "golden prompt test").
 *
 * ⚠️This only verifies, via heuristicToolSelector (a deterministic stub), that the harness wiring (fixture
 * loading, real catalog retrieval, pass/fail judgement, per-category aggregation) is not broken. The actual M3
 * gate verification ("the model picks the right tool(s)") — which needs a real LLM, a provider decision, and a
 * larger fixture set — is not yet complete (see docs/registry-readiness-checklist.md section D)
 *
 * Test wiring untuk harness golden-prompt (dokumen desain §12; dasar untuk item gate M3 "test golden prompt").
 *
 * ⚠️Ini hanya memverifikasi, via heuristicToolSelector (stub deterministik), bahwa wiring harness (pemuatan
 * fixture, pengambilan katalog sungguhan, penilaian benar/salah, agregasi per kategori) tidak rusak. Verifikasi
 * gate M3 yang sebenarnya ("model memilih tool yang benar") — yang membutuhkan LLM sungguhan, keputusan provider,
 * dan fixture set yang lebih besar — belum selesai (lihat docs/registry-readiness-checklist.md bagian D)
 */
import { describe, expect, it } from "vitest";
import { listRegisteredTools } from "../src/services/golden-prompts/tool-catalog.js";
import { heuristicToolSelector } from "../src/services/golden-prompts/heuristic-tool-selector.js";
import { runGoldenPromptFixtures } from "../src/services/golden-prompts/run-golden-prompts.js";
import { goldenPromptFixtures } from "./golden-prompts/fixtures.js";

describe("golden promptハーネス（heuristicスタブでの配線検証） / golden-prompt harness (wiring check via heuristic stub)", () => {
  it("実際に登録されている10個のM1ツールが取得できる / retrieves all 10 registered M1 tools", async () => {
    const tools = await listRegisteredTools();
    const toolNames = tools.map((tool) => tool.name).sort();
    expect(toolNames).toEqual(
      [
        "compliance.evaluate",
        "document.approve",
        "document.attach_executed_copy",
        "document.generate_draft",
        "document.preview",
        "document.record_delivery",
        "document.request_approval",
        "document.supersede",
        "job_order.analyze",
        "job_order.confirm",
      ].sort(),
    );
  });

  it("heuristicスタブは全フィクスチャ（直接・間接・否定形）に正しく答える / the heuristic stub answers every fixture correctly (direct, indirect, negative)", async () => {
    const tools = await listRegisteredTools();
    const summary = await runGoldenPromptFixtures(heuristicToolSelector, goldenPromptFixtures, tools);

    const failures = summary.results.filter((result) => !result.passed);
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(summary.passedCount).toBe(summary.totalCount);
    for (const category of ["direct", "indirect", "negative"] as const) {
      const bucket = summary.accuracyByCategory[category];
      expect(bucket.total).toBeGreaterThan(0);
      expect(bucket.passed).toBe(bucket.total);
    }
  });
});

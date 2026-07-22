/**
 * golden promptフィクスチャの一括実行・判定。ツール選択器（ToolSelector）と実際のツールカタログを受け取り、
 * フィクスチャごとの合否とカテゴリ（直接指示・間接指示・否定形）別の正答率を返す
 *
 * Runs a batch of golden-prompt fixtures and judges pass/fail. Given a tool selector and the real tool catalog,
 * returns per-fixture pass/fail plus accuracy broken down by category (direct, indirect, negative-form)
 *
 * Menjalankan sekumpulan fixture golden-prompt secara batch dan menilai lolos/gagal. Diberikan pemilih tool dan
 * katalog tool sebenarnya, mengembalikan lolos/gagal per fixture beserta akurasi per kategori (langsung, tidak
 * langsung, bentuk negatif)
 */
import type {
  GoldenPromptCategory,
  GoldenPromptFixture,
  GoldenPromptFixtureResult,
  GoldenPromptRunSummary,
  ToolDescriptorForSelection,
  ToolSelector,
} from "./types.js";

function sameToolSet(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  const expectedSet = new Set(expected);
  return actual.every((toolName) => expectedSet.has(toolName));
}

export async function runGoldenPromptFixtures(
  selector: ToolSelector,
  fixtures: readonly GoldenPromptFixture[],
  tools: readonly ToolDescriptorForSelection[],
): Promise<GoldenPromptRunSummary> {
  const results: GoldenPromptFixtureResult[] = [];

  for (const fixture of fixtures) {
    const { selectedToolNames } = await selector(fixture.prompt, tools);
    const passed = fixture.expectNoToolCall
      ? selectedToolNames.length === 0
      : sameToolSet(selectedToolNames, fixture.expectedToolNames);
    results.push({ fixture, actualToolNames: selectedToolNames, passed });
  }

  const accuracyByCategory: Record<GoldenPromptCategory, { total: number; passed: number }> = {
    direct: { total: 0, passed: 0 },
    indirect: { total: 0, passed: 0 },
    negative: { total: 0, passed: 0 },
  };
  for (const result of results) {
    const bucket = accuracyByCategory[result.fixture.category];
    bucket.total += 1;
    if (result.passed) {
      bucket.passed += 1;
    }
  }

  return {
    results,
    totalCount: results.length,
    passedCount: results.filter((result) => result.passed).length,
    accuracyByCategory,
  };
}

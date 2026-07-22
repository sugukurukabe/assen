/**
 * golden promptハーネスを手動実行するCLI（既定はheuristicToolSelectorスタブ）。フィクスチャ（test/golden-prompts/）
 * に依存するためtest/配下に置く（src/はtest/へ依存しない層構造を保つ）。
 * 実LLMへの差し替えはプロバイダ決定後（docs/registry-readiness-checklist.md B節）、heuristicToolSelectorの
 * importをLLM実装に差し替えるだけで済むよう、ToolSelector型で分離してある
 *
 * CLI to manually run the golden-prompt harness (defaults to the heuristicToolSelector stub). Lives under test/
 * because it depends on the fixtures (test/golden-prompts/) — keeps src/ from depending on test/.
 * Swapping in a real LLM (once a provider is decided, see docs/registry-readiness-checklist.md section B) only
 * requires replacing the heuristicToolSelector import — kept separate behind the ToolSelector type for exactly this
 *
 * CLI untuk menjalankan harness golden-prompt secara manual (default ke stub heuristicToolSelector). Ditempatkan
 * di bawah test/ karena bergantung pada fixture (test/golden-prompts/) — menjaga src/ agar tidak bergantung pada test/.
 * Mengganti dengan LLM sungguhan (setelah provider ditentukan, lihat docs/registry-readiness-checklist.md bagian B)
 * hanya membutuhkan penggantian import heuristicToolSelector — dipisah di balik tipe ToolSelector untuk tujuan ini
 */
import { listRegisteredTools } from "../../src/services/golden-prompts/tool-catalog.js";
import { heuristicToolSelector } from "../../src/services/golden-prompts/heuristic-tool-selector.js";
import { runGoldenPromptFixtures } from "../../src/services/golden-prompts/run-golden-prompts.js";
import { goldenPromptFixtures } from "./fixtures.js";
import { logMessage } from "../../src/lib/logger.js";

async function main(): Promise<void> {
  const tools = await listRegisteredTools();
  const summary = await runGoldenPromptFixtures(heuristicToolSelector, goldenPromptFixtures, tools);

  for (const result of summary.results) {
    if (!result.passed) {
      logMessage("error", "golden promptフィクスチャが不一致 / golden-prompt fixture mismatch", {
        id: result.fixture.id,
        category: result.fixture.category,
        expected: result.fixture.expectNoToolCall ? [] : result.fixture.expectedToolNames,
        actual: result.actualToolNames,
      });
    }
  }

  logMessage("info", "golden promptハーネス実行結果 / golden-prompt harness run result", {
    total: summary.totalCount,
    passed: summary.passedCount,
    accuracyByCategory: summary.accuracyByCategory,
  });

  if (summary.passedCount !== summary.totalCount) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logMessage("critical", "golden promptハーネスの実行に失敗しました / golden-prompt harness run failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

/**
 * ヒューリスティックなツール選択器（既定実装）。各ツールの実際のtitle/descriptionに含まれる語をキーワードとして
 * プロンプトとの一致を判定する。否定形（「〜しないで」等）を検出した場合はどのツールも選ばない。
 *
 * ⚠️これはgolden promptハーネス（フィクスチャ読込・カタログ取得・正誤判定・カテゴリ別集計）の配線を
 * 決定論的に検証するためのスタブであり、設計書§12・M3ゲート「golden promptテスト」が要求する
 * 「モデルが正しいツール列を選ぶ」検証そのものではない。実LLMへの差し替えはプロバイダ決定後
 * （docs/registry-readiness-checklist.md B節参照）に本ファイルと同じToolSelector型で行う
 *
 * Heuristic tool selector (default implementation). Matches keywords drawn from each tool's actual title/description
 * against the prompt. If a negation cue ("don't do X" etc.) is detected, selects no tool at all.
 *
 * ⚠️This is a stub that deterministically exercises the golden-prompt harness's wiring (fixture loading, catalog
 * retrieval, pass/fail judgement, per-category aggregation) — it is not the "the model picks the right tool"
 * verification that design doc §12 / M3 gate item "golden prompt test" actually requires. Swapping in a real LLM
 * happens once a provider is decided (see docs/registry-readiness-checklist.md section B), behind the same
 * ToolSelector type
 *
 * Pemilih tool heuristik (implementasi default). Mencocokkan kata kunci yang diambil dari title/description
 * sebenarnya setiap tool terhadap prompt. Jika terdeteksi penanda negasi ("jangan lakukan X" dll.), tidak memilih
 * tool sama sekali.
 *
 * ⚠️Ini adalah stub yang menguji wiring harness golden-prompt secara deterministik (pemuatan fixture, pengambilan
 * katalog, penilaian benar/salah, agregasi per kategori) — bukan verifikasi "model memilih tool yang benar" yang
 * sebenarnya dibutuhkan dokumen desain §12 / item gate M3 "test golden prompt". Mengganti dengan LLM sungguhan
 * dilakukan setelah provider ditentukan (lihat docs/registry-readiness-checklist.md bagian B), di balik tipe
 * ToolSelector yang sama
 */
import type { ToolDescriptorForSelection, ToolSelectionResult, ToolSelector } from "./types.js";

const NEGATION_CUES = ["しないで", "せずに", "しないでください", "don't", "do not", "without "];

/**
 * ツール名から日本語キーワードへの手動対応表。各ツールの実際のtitle/description（src/tools/配下）の語彙をそのまま使う
 * Manual tool-name-to-Japanese-keyword table. Reuses the vocabulary from each tool's actual title/description (src/tools/)
 * Tabel pemetaan manual nama-tool-ke-kata-kunci-Jepang. Menggunakan kembali vocabulary dari title/description sebenarnya setiap tool (src/tools/)
 */
const TOOL_KEYWORDS: Record<string, string[]> = {
  "job_order.analyze": ["求人メール", "解析", "原文"],
  "job_order.confirm": ["帳簿", "確定", "求人票"],
  "dispatch_assignment.confirm": ["派遣就業", "派遣元管理台帳", "台帳に記帳"],
  "compliance.evaluate": ["コンプライアンス", "適合性", "評価", "判定"],
  "document.preview": ["プレビュー", "下書き確認", "仕上がり"],
  "document.generate_draft": ["ドラフト", "労働条件通知書", "書類を作成", "生成して"],
  "document.request_approval": ["承認依頼", "承認を依頼", "レビュー依頼"],
  "document.approve": ["承認する", "承認して", "承認します"],
  "document.attach_executed_copy": ["署名済み", "押印済み", "添付"],
  "document.record_delivery": ["交付", "渡した", "送付記録"],
  "document.supersede": ["差し替え", "訂正版", "再発行"],
};

function containsNegationCue(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return NEGATION_CUES.some((cue) => normalized.includes(cue.toLowerCase()));
}

export const heuristicToolSelector: ToolSelector = (
  prompt: string,
  tools: readonly ToolDescriptorForSelection[],
): Promise<ToolSelectionResult> => {
  if (containsNegationCue(prompt)) {
    return Promise.resolve({ selectedToolNames: [] });
  }

  const availableToolNames = new Set(tools.map((tool) => tool.name));
  const selectedToolNames = Object.entries(TOOL_KEYWORDS)
    .filter(([toolName]) => availableToolNames.has(toolName))
    .filter(([, keywords]) => keywords.some((keyword) => prompt.includes(keyword)))
    .map(([toolName]) => toolName);

  return Promise.resolve({ selectedToolNames });
};

/**
 * golden promptテスト（設計書§12・M3ゲート「golden promptテスト」）の共通型。
 * 直接指示・間接指示・否定形の3系統で、ツール選択者が正しいツール列を選ぶかを回帰確認する
 *
 * Common types for the golden-prompt tests (design doc §12, M3 gate item "golden prompt test").
 * Verifies a tool selector picks the right tool(s) across three categories: direct, indirect, and negative-form instructions
 *
 * Tipe umum untuk test golden-prompt (dokumen desain §12, item gate M3 "test golden prompt").
 * Memverifikasi pemilih tool memilih tool yang benar di tiga kategori: instruksi langsung, tidak langsung, dan bentuk negatif
 */

export type GoldenPromptCategory = "direct" | "indirect" | "negative";

export interface GoldenPromptFixture {
  id: string;
  category: GoldenPromptCategory;
  /** ユーザーが実際に送る自然文（日本語想定。業務担当者の実際の言い回しに寄せる） / Natural-language text a user would actually send (Japanese; mirrors how operators actually phrase requests) / Teks bahasa natural yang benar-benar dikirim pengguna (Bahasa Jepang; mengikuti cara operator benar-benar berbicara) */
  prompt: string;
  /** 正しく選ばれるべきツール名（複数可）。expectNoToolCallがtrueの場合は無視される / Tool name(s) that should be selected. Ignored when expectNoToolCall is true / Nama tool yang seharusnya dipilih. Diabaikan jika expectNoToolCall true */
  expectedToolNames: string[];
  /** 否定形（「〜しないで」）用：どのツールも呼ばれるべきではないことを表す / For negative-form prompts ("don't do X"): asserts no tool should be called / Untuk prompt bentuk negatif ("jangan lakukan X"): menegaskan tidak ada tool yang seharusnya dipanggil */
  expectNoToolCall?: boolean;
  notes?: string;
}

export interface ToolDescriptorForSelection {
  name: string;
  description?: string;
}

export interface ToolSelectionResult {
  selectedToolNames: string[];
}

/**
 * プロンプトとツール一覧からツール選択を行う関数の型。M3では実LLM（プロバイダ未決定、docs/registry-readiness-checklist.md B節参照）
 * に差し替える。現時点ではheuristicToolSelector（下記）がハーネスの配線を検証するためのスタブとして存在する
 *
 * Type for a function that selects tool(s) given a prompt and the tool catalog. At M3 this gets swapped for a real
 * LLM call (provider undecided, see docs/registry-readiness-checklist.md section B). For now, heuristicToolSelector
 * (below) exists purely to exercise the harness wiring deterministically
 *
 * Tipe untuk fungsi yang memilih tool berdasarkan prompt dan katalog tool. Pada M3 ini akan diganti dengan panggilan
 * LLM sungguhan (provider belum ditentukan, lihat docs/registry-readiness-checklist.md bagian B). Untuk saat ini,
 * heuristicToolSelector (di bawah) hanya ada untuk menguji wiring harness secara deterministik
 */
export type ToolSelector = (prompt: string, tools: readonly ToolDescriptorForSelection[]) => Promise<ToolSelectionResult>;

export interface GoldenPromptFixtureResult {
  fixture: GoldenPromptFixture;
  actualToolNames: string[];
  passed: boolean;
}

export interface GoldenPromptRunSummary {
  results: GoldenPromptFixtureResult[];
  totalCount: number;
  passedCount: number;
  accuracyByCategory: Record<GoldenPromptCategory, { total: number; passed: number }>;
}

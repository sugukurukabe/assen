/**
 * golden promptフィクスチャ（設計書§12）。直接指示・間接指示・否定形の3系統で、M1の10ツールに対する
 * ツール選択の正誤を確認する。現時点ではheuristicToolSelector（決定論的スタブ）でハーネスの配線を検証する
 * ためのもので、実LLMでの正答率検証はプロバイダ決定後（M3）に行う
 *
 * Golden-prompt fixtures (design doc §12). Covers M1's 10 tools across three categories: direct instruction,
 * indirect instruction, and negative-form instruction. For now these only exercise heuristicToolSelector
 * (a deterministic stub) to validate the harness wiring; real-LLM accuracy verification happens at M3 once a
 * provider is decided
 *
 * Fixture golden-prompt (dokumen desain §12). Mencakup 10 tool M1 di tiga kategori: instruksi langsung, tidak
 * langsung, dan bentuk negatif. Untuk saat ini hanya menguji heuristicToolSelector (stub deterministik) untuk
 * memvalidasi wiring harness; verifikasi akurasi LLM sungguhan dilakukan di M3 setelah provider ditentukan
 */
import type { GoldenPromptFixture } from "../../src/services/golden-prompts/types.js";

export const goldenPromptFixtures: GoldenPromptFixture[] = [
  // --- 直接指示 / Direct instructions / Instruksi langsung ---
  { id: "direct-analyze", category: "direct", prompt: "この求人メールを解析してください。", expectedToolNames: ["job_order.analyze"] },
  { id: "direct-confirm", category: "direct", prompt: "この求人情報を帳簿に確定してください。", expectedToolNames: ["job_order.confirm"] },
  { id: "direct-evaluate", category: "direct", prompt: "この案件のコンプライアンス評価をしてください。", expectedToolNames: ["compliance.evaluate"] },
  { id: "direct-preview", category: "direct", prompt: "この書類のプレビューを見せてください。", expectedToolNames: ["document.preview"] },
  {
    id: "direct-generate-draft",
    category: "direct",
    prompt: "労働条件通知書のドラフトを生成してください。",
    expectedToolNames: ["document.generate_draft"],
  },
  {
    id: "direct-request-approval",
    category: "direct",
    prompt: "この書類の承認依頼を出してください。",
    expectedToolNames: ["document.request_approval"],
  },
  { id: "direct-approve", category: "direct", prompt: "この書類を承認してください。", expectedToolNames: ["document.approve"] },
  {
    id: "direct-attach-executed-copy",
    category: "direct",
    prompt: "署名済みの書類を添付してください。",
    expectedToolNames: ["document.attach_executed_copy"],
  },
  {
    id: "direct-record-delivery",
    category: "direct",
    prompt: "この書類を交付した記録を残してください。",
    expectedToolNames: ["document.record_delivery"],
  },
  { id: "direct-supersede", category: "direct", prompt: "この書類を差し替えてください。", expectedToolNames: ["document.supersede"] },

  // --- 間接指示 / Indirect instructions / Instruksi tidak langsung ---
  {
    id: "indirect-analyze",
    category: "indirect",
    prompt: "先ほど届いた求人メールの中身、確認してもらえますか？解析してみてほしいです。",
    expectedToolNames: ["job_order.analyze"],
  },
  {
    id: "indirect-confirm",
    category: "indirect",
    prompt: "この求人票の内容を帳簿に載せてもらってもいいですか？",
    expectedToolNames: ["job_order.confirm"],
  },
  {
    id: "indirect-evaluate",
    category: "indirect",
    prompt: "この案件、適合性の観点で一度見てもらえますか？",
    expectedToolNames: ["compliance.evaluate"],
  },
  {
    id: "indirect-preview",
    category: "indirect",
    prompt: "本番で送る前に、下書き確認だけしておきたいのですが。",
    expectedToolNames: ["document.preview"],
  },
  {
    id: "indirect-generate-draft",
    category: "indirect",
    prompt: "労働条件通知書、そろそろ書類を作成してもらえますか？",
    expectedToolNames: ["document.generate_draft"],
  },
  {
    id: "indirect-request-approval",
    category: "indirect",
    prompt: "この内容で問題なければ、レビュー依頼を回してもらえますか？",
    expectedToolNames: ["document.request_approval"],
  },
  {
    id: "indirect-approve",
    category: "indirect",
    prompt: "内容確認できたので、承認します。",
    expectedToolNames: ["document.approve"],
  },
  {
    id: "indirect-attach-executed-copy",
    category: "indirect",
    prompt: "押印済みの原本が届いたので、こちらに添付しておいてもらえますか？",
    expectedToolNames: ["document.attach_executed_copy"],
  },
  {
    id: "indirect-record-delivery",
    category: "indirect",
    prompt: "先方に渡したので、送付記録を残しておいてください。",
    expectedToolNames: ["document.record_delivery"],
  },
  {
    id: "indirect-supersede",
    category: "indirect",
    prompt: "内容に誤りがあったので、訂正版を作ってもらえますか？",
    expectedToolNames: ["document.supersede"],
  },

  // --- 否定形（「〜しないで」）/ Negative-form instructions / Instruksi bentuk negatif ---
  {
    id: "negative-analyze",
    category: "negative",
    prompt: "この求人メールはまだ解析しないでください。内容だけ確認したいです。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
  {
    id: "negative-confirm",
    category: "negative",
    prompt: "この案件はまだ帳簿に確定しないでください。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
  {
    id: "negative-evaluate",
    category: "negative",
    prompt: "今回はコンプライアンス評価をせずに進めてください。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
  {
    id: "negative-generate-draft",
    category: "negative",
    prompt: "労働条件通知書のドラフトはまだ生成しないでください。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
  {
    id: "negative-attach-executed-copy",
    category: "negative",
    prompt: "署名済みの原本はまだ来ていないので、添付しないでください。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
  {
    id: "negative-request-approval",
    category: "negative",
    prompt: "この書類の承認依頼はまだ提出しないでください。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
  {
    id: "negative-record-delivery",
    category: "negative",
    prompt: "先方への交付はまだ実施しないでください。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
  {
    id: "negative-supersede",
    category: "negative",
    prompt: "この書類の差し替えはまだ実施しないでください。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
  {
    id: "negative-preview",
    category: "negative",
    prompt: "プレビューはまだ確認しないでください。",
    expectedToolNames: [],
    expectNoToolCall: true,
  },
];

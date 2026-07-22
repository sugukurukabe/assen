# 法定書類カタログ（T2P一式④〜⑩・派遣3点＋台帳 A2/A3/A4/A5/A10） / Statutory Document Catalog / Katalog Dokumen Wajib

## 出典・位置づけ / Provenance & status / Asal & status

設計書v1（`法定書類自動化MCP_設計書_v1.md`。原本は本リポジトリ外の`/Users/kabe/Assen/`に置かれている）§1・§11は「T2P一式④〜⑩」「派遣3点（A2/A3/A10/台帳）」という表記を使うが、各番号が具体的に何の書類かの定義は**v1本文には存在しない**。唯一の記録は設計書v0ドラフト（`法定書類自動化MCP_設計書_v0ドラフト.md`、社内レビュー未実施・リポジトリ外（`~/Downloads/`）で保管）の§2.1・付録Bであり、M2着手にあたり壁の承認を得て本ファイルへそのまま正式インポートする（2026-07-23）。

This document imports, verbatim, the document-catalog table from design doc v0 (draft, never formally reviewed, previously kept outside this repository) into the repository, with sign-off from Kabe (2026-07-23), because design doc v1 uses the numbering (④–⑩, A2/A3/A10) without ever defining what each number refers to.

Dokumen ini mengimpor apa adanya tabel katalog dokumen dari draf desain v0 (draft, belum pernah direview secara formal, sebelumnya disimpan di luar repositori ini) ke repositori, dengan persetujuan Kabe (2026-07-23), karena dokumen desain v1 menggunakan penomoran (④–⑩, A2/A3/A10) tanpa pernah mendefinisikan arti masing-masing nomor.

**注意（重要）**：本カタログはv0ドラフトの記載をそのまま転記したものであり、社労士・行政書士による法的レビューを経ていない。`docs/registry-readiness-checklist.md` B節「法的意見書の依頼」が完了するまで、この内容を最終確定として扱わないこと。

---

## T2P一式（④〜⑩） / T2P document set (④–⑩) / Set dokumen T2P (④–⑩)

| 番号 | 書類名 | 送付方向 / 対象 | 根拠（v0記載） |
|---|---|---|---|
| ④ | 求人条件明示書 | 派遣元→求職者 | 職安法5条の3ほか（実務フローv1準拠） |
| ⑤ | 本人同意書 | 求職者→派遣元 | 実務フローv1準拠 |
| ⑥ | T2P個別契約書 | 派遣元⇔派遣先 | 実務フローv1準拠 |
| ⑦ | 転換条件覚書 | 派遣元⇔派遣先 | 実務フローv1準拠 |
| ⑧ | 不採用理由の明示請求 | 派遣元→派遣先 | 実務フローv1準拠 |
| ⑨ | 不採用理由の書面明示 | 派遣元→労働者 | 実務フローv1準拠 |
| ⑩ | 直接雇用切替同意書 | 派遣元⇔労働者 | v0設計書のみに記載（実務フローv1本文には直接の記述なし。B節の法的意見書取得時に要再確認） |

M1では④〜⑩のいずれも未実装（M1は`labor_conditions_notice`のみ）。M2 Phase 1（本フェーズ）でも④〜⑩は対象外。次フェーズで着手する。

---

## 派遣3点＋台帳（A2/A3/A4/A5/A10） / Dispatch "3 documents" + ledger / "3 dokumen" dispatch + buku besar

| コード | 書類名 | 根拠条文（v0記載） | 対応するdocType（本フェーズで新規実装） | 参考テンプレート資産 |
|---|---|---|---|---|
| A2 | 個別契約書（通常版） | 派遣法26条 | `dispatch_individual_contract` | `operations/registries/template_registry/02_労働者派遣個別契約書_スグクル様式_v3.2.md` |
| A3 | 就業条件明示書 | 派遣法34条 | `dispatch_working_conditions_notice` | `operations/registries/template_registry/1-13_就業条件明示書.md` |
| A4 | 派遣元管理台帳 | 派遣法37条 | ―（`dispatch_ledger_entries`テーブルへの自動記帳。文書生成ではなくDB正本＋将来の`ledger.export`で様式出力） | ― |
| A5 | 派遣先台帳雛形 | v0記載のみ（条文明示なし） | 未着手（次フェーズ以降で要否を確認） | ― |
| A10 | 派遣先通知 | 派遣法35条 | `dispatch_worker_notice` | `operations/registries/template_registry/04_派遣労働者通知書_スグクル様式_v1.0.md` |

**名称の不一致に関する注記**：v0ドラフトはA10を「派遣先通知」と呼ぶが、`aios`側の運用ランブック（[`operations/workspaces/派遣交代ランブック.md`](../../../operations/workspaces/派遣交代ランブック.md)）および既存テンプレート資産は同じ派遣法35条の書類を「派遣労働者通知書」と呼んでいる。条文根拠（派遣法35条：派遣先への通知義務）が一致するため、本カタログでは**同一の書類**として扱い、`dispatch_worker_notice`という一つのdocTypeに統一する。

A4とA5はいずれも「派遣先」ではなく「台帳」系だが、A4＝派遣元（自社）が備える管理台帳、A5＝派遣先（クライアント企業）に渡す台帳の雛形という違いがある。A4は既存の`dispatch_ledger_entries`テーブル（22項目・[`src/db/schema/ledgers.ts`](../src/db/schema/ledgers.ts)）で表現済みのため本フェーズで自動記帳を実装する。A5は雛形配布のみの性質が強く、DB正本化の要否を含め次フェーズ以降で判断する。

---

## 参照 / References / Referensi

- 設計書v0ドラフト §2.1（対象書類一覧）・付録B（参照資料）
- [`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md) B節「法的意見書の依頼」
- [`operations/registries/template_registry/`](../../../operations/registries/template_registry/)（既存テンプレート資産）

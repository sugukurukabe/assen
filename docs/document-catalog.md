# 法定書類カタログ（T2P一式④〜⑩・派遣3点＋台帳 A2/A3/A4/A5/A10） / Statutory Document Catalog / Katalog Dokumen Wajib

## 出典・位置づけ / Provenance & status / Asal & status

設計書v1（`法定書類自動化MCP_設計書_v1.md`。原本は本リポジトリ外の`/Users/kabe/Assen/`に置かれている）§1・§11は「T2P一式④〜⑩」「派遣3点（A2/A3/A10/台帳）」という表記を使うが、各番号が具体的に何の書類かの定義は**v1本文には存在しない**。唯一の記録は設計書v0ドラフト（`法定書類自動化MCP_設計書_v0ドラフト.md`、社内レビュー未実施・リポジトリ外（`~/Downloads/`）で保管）の§2.1・付録Bであり、M2着手にあたり壁の承認を得て本ファイルへそのまま正式インポートする（2026-07-23）。

This document imports, verbatim, the document-catalog table from design doc v0 (draft, never formally reviewed, previously kept outside this repository) into the repository, with sign-off from Kabe (2026-07-23), because design doc v1 uses the numbering (④–⑩, A2/A3/A10) without ever defining what each number refers to.

Dokumen ini mengimpor apa adanya tabel katalog dokumen dari draf desain v0 (draft, belum pernah direview secara formal, sebelumnya disimpan di luar repositori ini) ke repositori, dengan persetujuan Kabe (2026-07-23), karena dokumen desain v1 menggunakan penomoran (④–⑩, A2/A3/A10) tanpa pernah mendefinisikan arti masing-masing nomor.

**注意（重要）**：本カタログはv0ドラフトの記載をそのまま転記したものであり、社労士・行政書士による法的レビューを経ていない。`docs/registry-readiness-checklist.md` B節「法的意見書の依頼」が完了するまで、この内容を最終確定として扱わないこと。

---

## T2P一式（④〜⑩） / T2P document set (④–⑩) / Set dokumen T2P (④–⑩)

| 番号 | 書類名 | 送付方向 / 対象 | 根拠（v0記載） | 実装状況 | 対応するdocType |
|---|---|---|---|---|---|
| ④ | 求人条件明示書 | 派遣元→求職者 | 職安法5条の3ほか（実務フローv1準拠） | M2 Phase 2で実装済み | `t2p_job_order_notice` |
| ⑤ | 本人同意書 | 求職者→派遣元 | 実務フローv1準拠 | M2 Phase 2で実装済み（※注記1参照） | `t2p_consent_form` |
| ⑥ | T2P個別契約書 | 派遣元⇔派遣先 | 実務フローv1準拠 | M2 Phase 2で実装済み（※注記2参照） | `t2p_individual_contract` |
| ⑦ | 転換条件覚書 | 派遣元⇔派遣先 | 実務フローv1準拠 | M2 Phase 2で実装済み（採用確定時のみ生成） | `t2p_conversion_memo` |
| ⑧ | 不採用理由の明示請求 | 派遣元→派遣先 | 実務フローv1準拠 | M2 Phase 2で実装済み（不採用確定時のみ生成） | `t2p_non_hire_reason_request` |
| ⑨ | 不採用理由の書面明示 | 派遣元→労働者 | 実務フローv1準拠 | M2 Phase 2で実装済み（⑧回答受領後のみ生成） | `t2p_non_hire_reason_notice` |
| ⑩ | 直接雇用切替同意書 | 派遣元⇔労働者 | v0設計書のみに記載（実務フローv1本文には直接の記述なし。B節の法的意見書取得時に要再確認） | **スコープ外**（※注記3参照） | ― |

M1では④〜⑩のいずれも未実装（M1は`labor_conditions_notice`のみ）。M2 Phase 1では④〜⑩は対象外だった。M2 Phase 2（本フェーズ）で④〜⑨の生成基盤（`job_seeker.confirm`／`job_order_referral.confirm`／`placement.confirm`／`placement.record_rejection_reason`の4新規ツール＋各docType）を実装した。

**注記1（⑤の名称不一致・A10と同様のパターン）**：カタログはv0ドラフトの表記に従い「本人同意書」と呼ぶが、変換元テンプレート（`⑤本人同意書_日英併記_v1.docx`、`~/Downloads/`配下・社外・未レビュー）の実タイトルは「紹介予定派遣に関する説明書 兼 本人同意書」であり、単なる同意書ではなく説明書を兼ねる。A10（派遣先通知／派遣労働者通知書）と同じ理由（根拠となる実務が一致するため同一書類として扱う）により、`doc-type-registry.ts`の`docTypeLabel`は実タイトルに揃えている。

**注記2（⑥の実装方式）**：⑥はA2（`dispatch_individual_contract`）と同じ`dispatch_assignments.conditionsTyped`を再利用する（`subjectType: "dispatch_assignment"`、`t2pFlag=true`時のみ使用）。案件ごとに変動するT2P特有項目は紹介手数料額（既存`referralFeeRate`フィールドを必須化して再利用）のみで、その他のT2P条項（6ヶ月上限・試用期間なし・理由明示義務等）はテンプレート側に法定文言として直接記載している（詳細: [`src/domain/t2p-individual-contract.ts`](../src/domain/t2p-individual-contract.ts)）。

**注記3（⑩のスコープ外理由）**：⑩「直接雇用切替同意書」はv0ドラフトのみに記載があり、実務フローv1（`紹介予定派遣_実務フロー_v1.md.docx`、社外・未レビュー）の本文に記述がなく、対応するテンプレートDOCXも`~/Downloads/`配下に見つからなかった。M2 Phase 2ではユーザー承認のもとスコープ外とし、実装は行っていない。テンプレート・法的根拠が判明した時点で別フェーズとして再検討する。

**運用上の注意（④〜⑨共通）**：④〜⑨のテンプレート（[`legal/templates/t2p-*.v1.txt`](../legal/templates/)）はいずれも`~/Downloads/`配下の社外・未レビューDOCXテンプレートを`{{field}}`差込式に変換したものであり、社労士・行政書士による法的レビューは未実施（[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md) B節参照）。派遣3点書類（A2/A3/A10）と同様の運用上の注意が適用される。

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

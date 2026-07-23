# 社労士レビュー依頼ドラフト（第1バッチ） / Labor-and-social-security-attorney review request draft (batch 1) / Draf permintaan review konsultan ketenagakerjaan (batch 1)

このドキュメントは[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)B節「法的意見書の依頼」・[`法定書類自動化MCP_設計書_v1.md`](../../法定書類自動化MCP_設計書_v1.md)§3.2に基づく、社労士レビュー依頼の**送付前ドラフト**です。**このセッションでは実際にSlack送信・メール送信は行っていません**。壁が内容を確認し、必要な修正（宛名・案件名・敬称等）を加えた上で実際に送付してください。

This document is a **pre-send draft** of the labor-and-social-security-attorney (社労士) review request, per checklist section B ("legal opinion request") and design doc §3.2. **No Slack message or email has actually been sent in this session.** 壁 must review, adjust (recipient names, honorifics, etc.), and then actually send it.

Dokumen ini adalah **draf sebelum dikirim** untuk permintaan review konsultan ketenagakerjaan (社労士), sesuai bagian B checklist ("permintaan opini hukum") dan dokumen desain §3.2. **Tidak ada pesan Slack atau email yang benar-benar dikirim dalam sesi ini.** 壁 harus meninjau, menyesuaikan, dan baru benar-benar mengirimnya.

以下の文面ブロックは、実際にJapanese語ネイティブの相手（高平さん・社労士）へそのまま送ることを想定した**日本語のみの本文**です（Team Rulesの3言語ルールの対象は社内コード・ドキュメント本体で、実送信する対外文面はSlack日常メッセージ・commitメッセージと同様に1言語運用が実務上自然なため）。

---

## 1. 依頼の流れ / Flow / Alur

```mermaid
flowchart LR
  A[壁: 内容確認・宛名調整] --> B[高平さん（行政書士）へ紹介依頼]
  B --> C[紹介された社労士へ第1バッチ依頼]
  C --> D[意見書受領]
  D --> E[docs/document-catalog.md・テンプレートへ反映]
  E --> F[第2バッチ（T2P④〜⑨）を同じ社労士へ依頼]
```

- **第1バッチ（本ドラフトの対象）**：労働条件通知書・派遣3点書類（A2/A3/A10）
- **第2バッチ（後日、同じ社労士へ）**：T2P④〜⑨（求人条件明示書・本人同意書・T2P個別契約書・転換条件覚書・不採用理由請求／通知）
- レビュー完了までは、生成文書・承認画面のUIに「社内検証用ドラフト・対外提出前に人が最終確認」表示を維持する（[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)G節参照）

---

## 2. 高平さん（行政書士）への依頼文面ドラフト / Draft message to Takahira-san / Draf pesan ke Takahira-san

> 高平さん
>
> お世話になっております。壁です。
>
> スグクルで開発している「Assen」（職安法・派遣法・労基法の法定帳簿・書類生成を支援する社内システム）について、社労士の先生にレビューをお願いしたく、ご相談させてください。
>
> 現在、以下の書類テンプレートについて、既存様式の転記・実務フローの調査に基づきドラフトを作成しています。まだ社労士による法的レビューを一度も経ておらず、社内検証用の位置づけとして運用しています。
>
> - 労働条件通知書
> - 派遣個別契約書（A2）
> - 派遣労働条件明示書（A3）
> - 派遣労働者通知書（A10）
>
> これらのテンプレート内容の適法性チェックに加え、システムの運用設計そのもの（誰が最終責任を持つか、AIがどこまで関与してよいか等）についても、意見書の形でご確認いただける社労士の先生をご紹介いただけないでしょうか。
>
> 論点は9点にまとめており、詳細は別途お送りします（本ドラフト3節参照）。ご都合よろしいタイミングでお時間いただけますと幸いです。よろしくお願いいたします。
>
> 壁

---

## 3. 社労士への依頼文面ドラフト（第1バッチ） / Draft message to the labor-and-social-security attorney (batch 1) / Draf pesan ke konsultan ketenagakerjaan (batch 1)

> [社労士の先生]様
>
> はじめまして。スグクル株式会社の壁と申します。高平さん（行政書士）よりご紹介いただきました。
>
> 弊社では、特定技能外国人の派遣・紹介業務に伴う法定書類・法定帳簿の作成を支援する社内システム「Assen」を開発しております。AIエージェント（LLM）を使って原文（求人メール等）から事実を抽出しますが、**AIは事実抽出のみに用い、適法・違法の判断や条項の自動選択は一切行わない**設計にしています。すべての書類は「ドラフト」として生成され、必ず人間（承認者）が確認・承認するまで確定しません。
>
> このたび、以下2点についてご意見をいただきたく、ご相談させてください。
>
> **(A) テンプレート本文の適法性チェック（第1バッチ・4文書）**
>
> 1. 労働条件通知書
> 2. 派遣個別契約書（A2、派遣法26条）
> 3. 派遣労働条件明示書（A3、派遣法34条）
> 4. 派遣労働者通知書（A10、派遣法35条）
>
> いずれも既存の参考様式・実務資料を転記したドラフトで、まだ法的レビューを受けていません。差込項目（`{{フィールド名}}`形式）を含めた実際のテンプレート本文を別途お送りします。
>
> **(B) 運用設計そのものについてのご意見（9論点）**
>
> 1. 事実の選択・修正を最終的に行うのは誰か（当社の整理：ユーザー本人。システムは「verified_by」で証明を残す）
> 2. 条項の選択をシステム（AI含む）が自動決定していないか
> 3. 個別案件について適法・違法の結論をシステムが出していないか（当社の整理：判定は「条文×入力事実の突合結果」に限定し、`ambiguous`・`expert_review_required`の場合は確定をブロックし専門家相談を促す）
> 4. 問い合わせサポートが個別の法的助言になっていないか（サポート対応の台本整備の要否）
> 5. 料金設計が「書類作成の対価」ではなく「SaaS利用料」として構成されているか
> 6. 広告表現（「作成代行」「丸投げ」等の表現がNGにならないか）
> 7. テンプレート更新責任の所在（法改正時、誰が・どの契約に基づき更新するか）
> 8. 判断が曖昧な案件（グレー案件）を専門家へ引き継ぐフローの妥当性
> 9. 顧客自身が内容を理解・修正できるUIになっているか（承認画面のスクリーンショット・操作手順を別途お送りします）
>
> お忙しい中恐縮ですが、まずは(A)(B)についてご相談させていただけますと幸いです。ご都合のよいお日時をいくつかいただけますでしょうか。
>
> よろしくお願いいたします。
>
> スグクル株式会社　壁

---

## 4. 添付予定資料（別送） / Attachments to send separately / Lampiran yang dikirim terpisah

実送付時に、以下を添付・共有する（このセッションでは添付ファイルの選定リストのみ用意し、実送付は行っていない）：

| 資料 | 参照元 |
|---|---|
| 労働条件通知書テンプレート本文 | `legal/templates/labor-conditions-notice.v1.txt`・`legal/mapping/labor-conditions-notice.v1.json` |
| A2/A3/A10テンプレート本文 | `legal/templates/dispatch-*.v1.txt`・[`docs/document-catalog.md`](document-catalog.md)「派遣3点＋台帳」表 |
| 差込項目マッピングの一覧 | `legal/mapping/*.json`（フィールド名と条文根拠の対応） |
| 承認画面のスクリーンショット・操作説明 | [`docs/team-guide.md`](team-guide.md)7章 |
| findings（5値判定）の仕組みの説明 | [`docs/team-guide.md`](team-guide.md)9章、設計書§3.1 |
| 書類カタログ全体（背景説明用） | [`docs/document-catalog.md`](document-catalog.md) |

## 5. 第2バッチ予告メモ（送付は第1バッチ完了後） / Batch-2 note (send only after batch 1 completes) / Catatan batch 2 (kirim setelah batch 1 selesai)

第1バッチの意見書受領後、同じ社労士へ以下を追加依頼する（本ドラフトでは文面は作成していない。第1バッチのフィードバック内容を踏まえて別途作成する）：

- T2P④求人条件明示書・⑤本人同意書（実タイトル：紹介予定派遣に関する説明書兼本人同意書）・⑥T2P個別契約書・⑦転換条件覚書・⑧不採用理由の明示請求・⑨不採用理由の書面明示（[`docs/document-catalog.md`](document-catalog.md)「T2P一式」表参照）
- ⑩直接雇用切替同意書は現時点でスコープ外（テンプレート未整備）のため対象外

## 6. 完了後の反映先 / Where to reflect the outcome / Ke mana hasil direfleksikan

意見書を受領したら、以下を更新する：

- [`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)B節「法的意見書の依頼」を完了に更新
- 指摘に応じてテンプレート本文（`legal/templates/*.v1.txt`）・マッピング（`legal/mapping/*.json`）を修正し、`pnpm run legal:check-mapping`で機械検証を通す
- [`docs/document-catalog.md`](document-catalog.md)の「社労士・行政書士による法的レビューを経ていない」という注記を、レビュー済み文書について除去する
- UI・生成文書の「社内検証用ドラフト」表示は、レビュー完了かつ壁の承認が出るまで維持する

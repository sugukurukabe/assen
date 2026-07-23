# 社内シャドーランrunbook（自社MVP・初回1件） / Internal shadow-run runbook (internal MVP, first case) / Runbook shadow-run internal (MVP internal, kasus pertama)

このドキュメントは[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)G節「社内シャドーラン」の実行手順です。対象は**非開発者**（deal desk担当または派遣管理担当）1名で、**実案件1件**（テストで使っている「あずま園」のような架空データではなく、実際に進行中の求人または派遣案件）を、Assenで実際に動かします。

This document is the execution procedure for checklist section G's "internal shadow run." The audience is one **non-developer** (either the deal-desk or dispatch-management owner), and the target is **one real case** — an actual in-flight job order or dispatch placement, not test fixtures like the "Azuma-en" example used in the test suite.

Dokumen ini adalah prosedur eksekusi untuk "shadow run internal" pada bagian G checklist. Audiensnya adalah satu **non-developer** (pemilik deal desk atau manajemen dispatch), dan targetnya adalah **satu kasus nyata** — lowongan atau penempatan dispatch yang sedang berjalan, bukan fixture test seperti contoh "Azuma-en" yang dipakai test suite.

## 対象読者への前提 / Prerequisites for the reader / Prasyarat untuk pembaca

- [`docs/team-guide.md`](team-guide.md)の1〜4章を読み終えていること（roleの意味・プロンプトの使い方）
- Cursor/Claude等のAIエージェントからAssenへ接続できていること（3章参照）。接続先はローカル/検証環境で構いません（本番相当環境の準備状況は[`docs/ops-runbook.md`](ops-runbook.md)参照。用意でき次第この節を更新します）
- 対象案件は**架空データではない**が、まだ対外的に確定していない・確定直後の案件を選ぶこと（初回は失敗しても実害が小さい案件が望ましい）

## 大原則：確定記帳前に必ずpreviewする / Golden rule: always preview before confirming / Aturan utama: selalu preview sebelum confirm

`job_order.confirm`・`dispatch_assignment.confirm`・`document.generate_draft`はいずれも**DBへ確定記帳する操作**です。一度確定すると、内容の変更は「訂正版発行」（[`docs/team-guide.md`](team-guide.md)8章）という別の手続きになり、単純な取り消しはできません。したがって：

- `job_order.confirm`の**前**に、必ず`job_order.analyze`の結果（候補事実・欠落項目・confidence・矛盾）を担当者自身の目で確認する
- `document.generate_draft`の**前**に、必ず`document.preview`で差込値・出典・法定必須項目の充足状況を確認する
- 疑わしい点が1つでもあれば、その場で確定せず、エージェントに聞き直す・不足情報を集める

## 手順（純紹介案件の場合） / Steps (for a pure-referral case) / Langkah (untuk kasus referral murni)

1. 実際の求人メール・求人情報の原文を用意する（コピー＆ペーストできる形で）
2. エージェントに`intake-job-order`プロンプトを、`sourceText`＝求人原文、`sourceUri`＝元のSlackリンク等で実行するよう依頼する
3. エージェントが返す`fact_assertions`・欠落項目・confidence・矛盾を**自分の知っている実際の求人内容と1件ずつ突き合わせて確認する**。エージェントの要約だけで済ませない
4. 確認が済んだら、エージェントに「確認済みの内容で`job_order.confirm`してください」と依頼する（このタイミングで初めてDBに確定記帳される）
5. `compliance.evaluate`の結果（[`docs/team-guide.md`](team-guide.md)9章の5値）を確認する。`ambiguous`・`expert_review_required`が出た場合は、社労士レビュー待ちであることを踏まえ、その場で判断を急がない
6. 労働条件通知書について、`document.preview`で差込値・出典を確認してから`document.generate_draft`を依頼する
7. 承認者役（`approver`）に依頼し、[`docs/team-guide.md`](team-guide.md)7章の承認画面で内容を確認・承認してもらう（**この初回シャドーランでは、実際に対外交付する前に必ず壁または高平さんにも文面を目視確認してもらう**。社労士レビュー未完了のため）
8. `document.attach_executed_copy`・`document.record_delivery`は、社内確認が済み対外提出が実際に許可された場合のみ実行する。許可が出ていない間は、6〜7で止めて構わない（draft止まりでも「承認〜交付ラインが機能する」ことの確認は十分できる）

## 手順（派遣案件の場合） / Steps (for a dispatch case) / Langkah (untuk kasus dispatch)

[`docs/team-guide.md`](team-guide.md)6.5章の手順に沿って進める。`dispatch_assignment.confirm`の前に、契約期間・就業場所・抵触日・社会保険加入状況等を担当者自身が原本（契約書ドラフト・派遣先からの回答）と突き合わせて確認すること。A2/A3/A10の3文書それぞれについて、上記「純紹介案件」の手順6〜8と同じ確認プロセスを繰り返す。

## シャドーラン中に記録すること / What to record during the shadow run / Yang harus dicatat selama shadow run

シャドーラン終了後、以下を`#90_dev`（Slack）へ簡潔に報告する：

- [ ] `job_order.analyze`（または`dispatch_assignment.confirm`前の確認）で、LLMの抽出結果と実際の案件内容に食い違いがあったか（あれば具体的に）
- [ ] `compliance.evaluate`のfindingsで`ambiguous`／`expert_review_required`が出たか（出た場合、`ruleKey`とその時の対応）
- [ ] 承認画面（MCP App）は問題なく開けたか、表示内容は理解できたか
- [ ] `docs/team-guide.md`の説明と実際の挙動に齟齬がなかったか（あれば具体的な章番号とともに）
- [ ] 全体の所要時間の感覚（次回以降の運用設計の参考にする）

## 完了条件 / Done criteria / Kriteria selesai

上記手順を1件通し終え、報告をSlackへ投稿した時点で、[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)G節「社内シャドーラン」の項目を`[x]`にできる。**本番相当環境（Cloud Run）が準備できていない間は、ローカル/検証環境でのシャドーランでも本項目の趣旨（チームガイドに沿って非開発者が実案件を動かせること）は満たせる**が、G節全体のDone条件（本番相当環境での完走）を満たすには、環境準備後に同じ手順を本番相当環境で再度実施する必要がある。

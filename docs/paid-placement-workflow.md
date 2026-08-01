# 有料職業紹介ワークフロー / Paid Placement Workflow / Alur Penyaluran Berbayar

紹介ローンチ設計書v1.2・ワークフロー設計v1.1・チャンネル設計v7.2にAssenを合わせた運用ガイド。
Assenは帳簿①②③とパイプラインの**正本**。ClaudeがSlack投稿（WF-15A/10A/25H）を起点にツールを呼ぶ。
Assen is the **source of truth** for Ledgers #1/#2/#3 and the pipeline. Claude calls tools from Slack posts (WF-15A/10A/25H).
Assen adalah **sumber kebenaran** Buku Besar #1/#2/#3 dan pipeline. Claude memanggil tool dari posting Slack (WF-15A/10A/25H).

接続はClaude ConnectorにAssenの`/mcp` URLを追加するだけのワンクリックOAuthを標準手順にする。手動token取得はトラブル時のみ。
One-click OAuth is the standard connection path: add Assen's `/mcp` URL to Claude Connector. Manual token retrieval is troubleshooting-only.
OAuth sekali klik adalah prosedur standar: tambahkan URL `/mcp` Assen ke Claude Connector. Pengambilan token manual hanya untuk troubleshooting.

## 成約パターン P1–P5 / Placement patterns / Pola penempatan

| パターン | 流れ | Assenツール |
|---|---|---|
| P1 純紹介×Zキャリア | inquiry → job_order(score) → referral → placement | `inquiry.*` → `job_order_score` → `job_order_referral_confirm` → `placement_confirm` |
| P2 純紹介×直接求人（建設監督） | job_order + G1 → inquiry → referral → placement | `job_order_gate_check`（監督職必須）→ 同上 |
| P3 紹介予定派遣（T2P） | job_order(t2p) → dispatch → placement(T2P成立) | 既存T2P書類④〜⑨＋`placement_confirm` |
| P4 派遣→純紹介切替 | inquiry(channel=internal_conversion) → placement | `inquiry_record`経路「社内転換」 |
| P5 スグクル派遣→WIN移行 | 本人希望/企業の直接雇用化 → placement(WIN移行) | `placement_confirm`（`conversionType=win_transition`, `feeStatus=pending_negotiation`可） |

`placement_confirm`の転換種別は3択: `standard_placement_hire`（通常紹介の入社）、`t2p_conversion`（紹介予定派遣の成立）、`win_transition`（WIN移行）。
`placement_confirm` accepts three conversion types: `standard_placement_hire`, `t2p_conversion`, and `win_transition`.
`placement_confirm` menerima tiga jenis konversi: `standard_placement_hire`, `t2p_conversion`, dan `win_transition`.

## 職安法6関所 / ESA gates G1–G6 / Gerbang ESA

| 関所 | Assenでの実装 |
|---|---|
| G1 受理チェック | `job_order_gate_check`（実作業ベース。肩書だけでは通さない）＋`legal/rules/esa-gates.v1.json` |
| G2 ④交付 | `compliance_evaluate`(job_order_referral) がdeliveryStatusを検査 |
| G3 ⑤同意 | 同上（approved/executed） |
| G4 帳簿三点 | `job_order_confirm` / `inquiry_promote`→`job_seekers` / `placement_confirm`→`fee_records` |
| G5 手数料 | 成立後のみ記帳・`noPoachingUntil`（採用+2年） |
| G6 的確表示 | `job_order_gate_check`の`adCopy`または`checkAccurateRepresentation` |

## 2段階インテーク / Two-stage intake / Intake 2 tahap

1. `inquiry_record` — Stage 0（DM5問。パイプラインには載せない）
2. `inquiry_update` — 正式申込セット送付・書類受領。7日無応答で自動クローズ
3. `inquiry_promote` — セット完備時のみ帳簿②へ昇格（**WF-15A起票条件の正本**）

### 流入元タグ / Source tag / Tag sumber

経路enumは6値（`sugukuru_job` / `win_job` / `sns_application` / `other_agency` / `direct_referral` / `internal_conversion`）で、
**広告の媒体・フォームまでは区別しない**。Metaリードフォームからのリードも自然流入のSNS応募も同じ `sns_application` に入る。
広告費の判断（CPL・経路別申込率）にはこれでは足りないため、`inquiry_record` / `inquiry_update` の
`sourceTag`（例: `meta_lead_form` / `meta_dm` / `ig_organic`）で細かい単位を持つ。
`sourceDetail` にキャンペーン名・広告セットIDを入れると内訳まで残せる（個人情報は入れない）。

`kpi_weekly_summary` の `inquiryBySourceTag` がタグ別に 問い合わせ→セット送付→受領→候補者 を返す。
タグ未設定は `untagged` にまとまるので、広告開始後に `untagged` が増えていたら付け忘れとして扱う。

**制約**: タグは `inquiries` にしか載らない。`job_seekers` へは引き継がれないため、
タグ別の成約数・成約単価はまだ出せない（`inquiryBySourceTag` は候補者昇格まで）。

## オシン日次・週次 / Oshin daily & weekly / Harian & mingguan Oshin

| タイミング | プロンプト | 主なツール |
|---|---|---|
| 09:00 朝スキャン | `morning-scan` | `job_order_gate_check` / `job_order_score` / `job_order_list` |
| 候補者突合（72h） | `match-candidates` | `job_order_list` + referral確認 |
| 月曜30分 | `weekly-review` | `kpi_weekly_summary`（任意でSlack投稿） |

## WF-25H 相当（成約4点同時） / Placement 4-point fire

`placement_confirm`(outcome=hired) が1トランザクションで:

1. 帳簿③ `fee_records` 記帳（P5/WIN移行で協議中なら`feeStatus=pending_negotiation`で請求保留）
2. 手数料請求ドラフト（`feeInvoiceDraft`＋`fee_invoice_drafts`永続化）
3. 随時届出案内（スグクル3-1-2＋受入3-1-1、14日期限）
4. referral=`placed`・求人`filled`・求職者`placed`・Slack通知（成約→#15、請求ドラフト→#40）

## 採点表v1.2 / Scorecard v1.2 / Tabel skor v1.2

`job_order_score`は6軸でS/A/B/Cを返す。Sは9点以上、Aは6〜8点、B/Cは原則追わない。ただし建設監督系は`routeToP2Lane=true`なら壁・吉原判断へ回す。
`job_order_score` returns S/A/B/C across six axes. S is 9+, A is 6-8, and B/C are not pursued by default. Construction-supervisor exceptions go to Kabe/Yoshihara when `routeToP2Lane=true`.
`job_order_score` mengembalikan S/A/B/C berdasarkan enam sumbu. S adalah 9+, A adalah 6-8, dan B/C tidak dikejar kecuali pengecualian pengawas konstruksi dengan `routeToP2Lane=true`.

6軸目は§03の4レーン（ホテル・外食・携帯ショップ・JA事務員）への適合。該当で+2、社会人経験者を求める求人なら+1。
The sixth axis is fit to the four §03 lanes: hotel, restaurant, mobile shop, and JA office. Fit gives +2; experienced-worker preference gives +1.
Sumbu keenam adalah kecocokan dengan 4 jalur §03: hotel, restoran, toko ponsel, dan staf kantor JA. Cocok +2; preferensi pengalaman kerja +1.

## 事業区分 / Business flag / Klasifikasi bisnis

WF共通フィールドの事業区分は`businessFlag`として保存する。値は`sugukuru`、`win`、`shared`。求人・求職者・紹介行・派遣就業に入り、KPIは事業別にも集計する。
The shared Workflow business field is stored as `businessFlag`: `sugukuru`, `win`, or `shared`. It is present on job orders, job seekers, referrals, and dispatch assignments, and KPI output can split by business.
Field bisnis bersama Workflow disimpan sebagai `businessFlag`: `sugukuru`, `win`, atau `shared`. Field ini ada pada lowongan, pencari kerja, rujukan, dan dispatch, lalu KPI bisa dipisah per bisnis.

## Phase 2機能 / Phase 2 features / Fitur Phase 2

- `report_monthly_summary` — §10テンプレで月次ファネル・手数料・経路別/事業別内訳を作る / Creates the §10 monthly funnel, fee, channel, and business breakdown / Membuat funnel bulanan §10, fee, jalur, dan rincian bisnis
- `invoice_create_draft` — freee登録前の請求ドラフトを永続化する / Persists invoice drafts before freee posting / Menyimpan draf tagihan sebelum posting freee
- `dispatch_assignment_confirm` — T2Pなら4ヶ月/5ヶ月/6ヶ月の`deadline_instances`を自動生成する / Creates 4/5/6-month deadline instances for T2P dispatch / Membuat deadline 4/5/6 bulan untuk dispatch T2P

## 環境変数 / Environment / Variabel lingkungan

- `SLACK_KPI_CHANNEL_ID` — 週次5指標の投稿先（未設定なら月曜自動投稿スキップ）
- `SLACK_FINANCE_CHANNEL_ID` — #40_finance相当。請求ドラフトの投稿先 / #40_finance equivalent for invoice drafts / Setara #40_finance untuk draf tagihan
- `SLACK_BOARD_CHANNEL_ID` — #95相当。月次レポート・経営レビューの投稿先 / #95-equivalent board channel for monthly reports / Channel board setara #95 untuk laporan bulanan
- 既存の`SLACK_BOT_TOKEN` / `SLACK_APPROVAL_CHANNEL_ID` — 承認通知

## Registry公開について / Registry publication / Publikasi Registry

公式MCP Registryへの公開・標準準拠強化は**後回し（backlog）**。事業特化を優先する。
Official MCP Registry publication is deferred (backlog); business specialization comes first.
Publikasi Registry MCP resmi ditunda (backlog); spesialisasi bisnis didahulukan.

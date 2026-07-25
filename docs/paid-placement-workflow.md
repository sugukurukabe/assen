# 有料職業紹介ワークフロー / Paid Placement Workflow / Alur Penyaluran Berbayar

紹介ローンチ設計書v1.1・ワークフロー設計v1.1・チャンネル設計v7.2にAssenを合わせた運用ガイド。
Assenは帳簿①②③とパイプラインの**正本**。ClaudeがSlack投稿（WF-15A/10A/25H）を起点にツールを呼ぶ。
Assen is the **source of truth** for Ledgers #1/#2/#3 and the pipeline. Claude calls tools from Slack posts (WF-15A/10A/25H).
Assen adalah **sumber kebenaran** Buku Besar #1/#2/#3 dan pipeline. Claude memanggil tool dari posting Slack (WF-15A/10A/25H).

接続はClaude ConnectorにAssenの`/mcp` URLを追加するだけのワンクリックOAuthを標準手順にする。手動token取得はトラブル時のみ。
One-click OAuth is the standard connection path: add Assen's `/mcp` URL to Claude Connector. Manual token retrieval is troubleshooting-only.
OAuth sekali klik adalah prosedur standar: tambahkan URL `/mcp` Assen ke Claude Connector. Pengambilan token manual hanya untuk troubleshooting.

## 成約パターン P1–P4 / Placement patterns / Pola penempatan

| パターン | 流れ | Assenツール |
|---|---|---|
| P1 純紹介×Zキャリア | inquiry → job_order(score) → referral → placement | `inquiry.*` → `job_order.score` → `job_order_referral.confirm` → `placement.confirm` |
| P2 純紹介×直接求人（建設監督） | job_order + G1 → inquiry → referral → placement | `job_order.gate_check`（監督職必須）→ 同上 |
| P3 紹介予定派遣（T2P） | job_order(t2p) → dispatch → placement(T2P成立) | 既存T2P書類④〜⑨＋`placement.confirm` |
| P4 派遣→純紹介切替 | inquiry(channel=internal_conversion) → placement | `inquiry.record`経路「社内転換」 |

## 職安法6関所 / ESA gates G1–G6 / Gerbang ESA

| 関所 | Assenでの実装 |
|---|---|
| G1 受理チェック | `job_order.gate_check`（実作業ベース。肩書だけでは通さない）＋`legal/rules/esa-gates.v1.json` |
| G2 ④交付 | `compliance.evaluate`(job_order_referral) がdeliveryStatusを検査 |
| G3 ⑤同意 | 同上（approved/executed） |
| G4 帳簿三点 | `job_order.confirm` / `inquiry.promote`→`job_seekers` / `placement.confirm`→`fee_records` |
| G5 手数料 | 成立後のみ記帳・`noPoachingUntil`（採用+2年） |
| G6 的確表示 | `job_order.gate_check`の`adCopy`または`checkAccurateRepresentation` |

## 2段階インテーク / Two-stage intake / Intake 2 tahap

1. `inquiry.record` — Stage 0（DM5問。パイプラインには載せない）
2. `inquiry.update` — 正式申込セット送付・書類受領。3日無応答で自動クローズ
3. `inquiry.promote` — セット完備時のみ帳簿②へ昇格（**WF-15A起票条件の正本**）

## オシン日次・週次 / Oshin daily & weekly / Harian & mingguan Oshin

| タイミング | プロンプト | 主なツール |
|---|---|---|
| 09:00 朝スキャン | `morning-scan` | `job_order.gate_check` / `job_order.score` / `job_order.list` |
| 候補者突合（72h） | `match-candidates` | `job_order.list` + referral確認 |
| 月曜30分 | `weekly-review` | `kpi.weekly_summary`（任意でSlack投稿） |

## WF-25H 相当（成約4点同時） / Placement 4-point fire

`placement.confirm`(outcome=hired) が1トランザクションで:

1. 帳簿③ `fee_records` 記帳
2. 手数料請求ドラフト（`feeInvoiceDraft`）
3. 随時届出案内（スグクル3-1-2＋受入3-1-1、14日期限）
4. referral=`placed`・求人`filled`・求職者`placed`・Slack通知（outbox）

## 環境変数 / Environment / Variabel lingkungan

- `SLACK_KPI_CHANNEL_ID` — 週次5指標の投稿先（未設定なら月曜自動投稿スキップ）
- 既存の`SLACK_BOT_TOKEN` / `SLACK_APPROVAL_CHANNEL_ID` — 承認・成約通知

## Registry公開について / Registry publication / Publikasi Registry

公式MCP Registryへの公開・標準準拠強化は**後回し（backlog）**。事業特化を優先する。
Official MCP Registry publication is deferred (backlog); business specialization comes first.
Publikasi Registry MCP resmi ditunda (backlog); spesialisasi bisnis didahulukan.

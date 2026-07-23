# 法定書類自動化MCP「Chobo」設計書 v1（再設計版）

**ステータス**: v0レビュー反映済み・実装着手可能版
**作成**: 2026-07-22 壁
**v0からの位置づけ変更**: 「監査ログ付き書類生成システム」→「**継続的コンプライアンスOS**」。製品価値は「MCPでPDFが作れること」ではなく、**法改正に追従し、判断根拠と版を再現でき、監査時に証拠を即時提示できること**。

---

## 0. v0 → v1 変更サマリ（レビュー10結論の採否）

| # | レビュー結論 | 採否 | 反映先 |
|---|---|---|---|
| 1 | 「DBの行が正本」→「DBの版付き状態＋GCSの不変文書が正本」 | **採用** | §2 |
| 2 | マスタ非複製→「マスタ参照＋法的スナップショット」 | **採用** | §4.3 |
| 3 | JSONB中心→「法定必須は型付き列、拡張のみJSONB」 | **採用** | §4.2 |
| 4 | LLM判定→「LLMは抽出、法令判定は決定論的ルール」 | **採用** | §6 |
| 5 | 単一status→複数の独立状態機械 | **採用** | §5 |
| 6 | finalize_document→承認・署名・交付に分割 | **採用** | §7 |
| 7 | 四半期法令確認→公式ページの継続差分監視 | **採用**（週次＋改正予告時は日次） | §10 |
| 8 | マージン率7/10を法定期限でなく社内目標として区別 | **採用** | §11 |
| 9 | confirmed_byを入力値でなく認証主体から取得 | **採用** | §4.5・§7 |
| 10 | 外販βでAIOS本体とデータ・権限・障害範囲を分離 | **採用**（Phase 0は条件付き同居） | §2.3 |

Go/No-Go判定の受け入れ：自社プロトタイプ着手＝条件付きGo（本v1が条件の解消）／v0スキーマのままの本番正本化＝しない／外販βはM3の客観ゲート通過後。

---

## 1. 目的・スコープ（v0から維持、要点のみ）

- **対象**: 職安法・派遣法・労基法の法定書類（帳簿①②③、派遣3点＋α、労働条件通知書、T2P一式④〜⑩、様式8号/11号、マージン率開示、コンプライアンスチェック）
- **非対象**: ビザ・在留書類（AIOSX/SSW Compass/Drapt領域）、e-Gov/ACCORD提出、給与計算・社保（freee領域）、労使協定等の規程系は雛形提供のみ
- **順序**: Phase 0 自社ドッグフーディング → 客観ゲート通過後に外販β（全エージェント向け・月額数千〜1万円台）
- **許可番号の正**: 有料職業紹介・労働者派遣それぞれの許可番号は`tenant_settings`を唯一の参照元とする（他ドキュメントに記載の値との不一致は誤記→修正対象）

---

## 2. アーキテクチャ原則

### 2.1 正本の階層（v1で確定）

```
Cloud SQL : 業務状態・版・監査メタデータの正本
GCS       : 不変な文書バイト列の正本（content-addressable、SHA-256）
Drive     : 閲覧・共有用の派生コピー（正本ではない）
Slack     : 入口・通知面（正本ではない）
```

### 2.2 整合性：transactional outbox

DBトランザクション内で「状態変更＋outboxイベント」を同時コミットし、GCS/Drive/Slack/freeeへの反映は冪等workerが実行する。部分障害（DBはconfirmedだがGCS保存失敗、等）を構造的に排除する。

```
transactional_outbox
  id, tenant_id, aggregate_type, aggregate_id, event_type,
  payload(JSONB), idempotency_key UNIQUE,
  status(pending/processing/done/dead),
  attempt_count, next_retry_at, last_error, external_reference,
  created_at
```

### 2.3 デプロイ・DB配置

- **モノレポ維持**（`sugukuru-aios/apps/compliance`）、Cloud Runは独立サービス
- **Phase 0**: aiosx-pg同居を以下の条件付きで許容——compliance専用スキーマ＋専用schema owner、専用サービスアカウント、RLS有効、PITRバックアップ、リソース上限、既存AIOSテーブルへの直接書込禁止、migration権限とruntime権限の分離
- **外販β開始時**: 別Cloud SQLインスタンス（可能なら別GCPプロジェクト）へ分離。blast radius切り離しのため

### 2.4 MCPプロトコル互換（2026-07時点）

安定版 `2025-11-25` を本線とし、`2026-07-28` RC（7/28正式公開予定・ステートレス化等の破壊的変更）に備えてアダプタ層を分離する。

```
MCP protocol adapter（2025-11-25 / 2026-07-28）
        ↓
stateless application services   ← MCPセッションに業務状態を置かない
        ↓
domain DB / policy engine / storage
```

- 申請途中・承認待ち等の状態はすべてDB上の `operation_id / task_id / approval_request_id` で再開可能にする
- SDKはバージョン固定。βSDKは互換テストレーンのみ、本番不使用
- 長時間処理（年次報告・大量生成）はMCP Tasksを使いつつ、**非対応クライアント向けにjob handle＋polling（report.start/status/result）を常設**

---

## 3. 法的設計原則 v2（社労士法・製品境界）

v0の4原則（作成主体はユーザー／提出代行しない／個別判断しない／免責明示）は維持。ただし**「承認ボタンがあるから適法」という扱いはしない**。以下を追加する。

### 3.1 rule_result の5値化（曖昧を勝手にpassへ落とさない）

```
rule_result: pass / fail / incomplete / ambiguous / expert_review_required
```

`ambiguous` と `expert_review_required` は書類確定をブロックし、定型文「専門家（社労士・弁護士）にご相談ください」＋専門家引継ぎ導線を出す。モデル・ルールエンジンのいずれもこの2値をpassに変換できない（コードレベルで遷移を禁止）。

### 3.2 外販前の法的意見書のスコープ（コードだけでなく運用・商流全体）

- 誰が事実を選択・修正するか（＝ユーザー。fact_assertionsのverified_byで証明）
- 条項選択をシステムが自動決定していないか
- 個別案件について適法・違法の**結論**を出していないか（findingsは条文×事実の突合結果に限定）
- 問い合わせサポートが個別助言化しないか（サポート台本の整備）
- 料金が「書類作成の対価」と評価されない価格・契約設計か（SaaS利用料として構成）
- 広告表現（「作成代行」「丸投げ」等のNGワードリスト）
- テンプレート更新責任の所在（利用規約）
- グレー案件の専門家引継ぎフロー
- 顧客自身が内容を理解・修正できるUIか（MCP App承認画面がこの証明になる）

高平さん（行政書士）経由で社労士を紹介依頼し、意見書は上記9点を対象に取得する。

---

## 4. データモデル v2（complianceスキーマ）

### 4.1 設計方針

1. **法定必須項目は型付きカラム＋NOT NULL、任意・拡張のみJSONB**
2. 全テーブルに `tenant_id` を持ち、PostgreSQL RLSでテナント分離（Phase 0から）
3. マスタ（staff/companies）は**参照**しつつ、法的イベント時点の**不変スナップショット**を保存
4. PII（氏名・住所・生年月日）はアプリ層暗号化（KMS、AIOSXと同方式）。ログへのPII・メール本文・求人原文の出力禁止

### 4.2 法定帳簿テーブル（厚労省記載要領準拠の型付き列）

```
job_orders（求人管理簿の正本）
  id, tenant_id, company_id(→companies参照),
  employer_snapshot_id(→party_snapshots),        -- 受理時点の事業所名・所在地・担当者・連絡先
  accepted_at DATE NOT NULL,                      -- 受付年月日
  valid_until DATE NOT NULL,                      -- 有効期間
  headcount INT NOT NULL,                         -- 求人数
  occupation TEXT NOT NULL,                       -- 職種
  work_location TEXT NOT NULL,                    -- 就業場所
  employment_period_type(indefinite/fixed) NOT NULL, employment_period_detail,
  wage_amount_min NUMERIC, wage_amount_max NUMERIC,
  wage_unit(hour/day/month/year) NOT NULL,        -- 賃金と支払単位・上下限
  t2p_flag BOOL NOT NULL,                         -- 様式8号別掲に直結
  refund_system BOOL NOT NULL,                    -- 返戻金制度の有無
  source(zcareer/exord/direct/sns), source_artifact_id(→source_artifacts),
  status(open/filled/closed),
  extras JSONB,                                   -- 拡張のみ
  retention_until DATE                            -- 完結の日から2年

job_order_referrals（紹介行：求人×求職の交差＝両帳簿の紹介欄）
  id, tenant_id, job_order_id, job_seeker_id,
  referred_at DATE,                               -- 紹介日
  outcome(hired/rejected/withdrawn/pending),       -- 採否
  hired_at DATE,                                  -- 採用日
  indefinite_employment BOOL,                     -- 無期雇用区分
  no_poaching_until DATE,                         -- 転職勧奨禁止期間（採用日から2年）
  early_leave_check_at DATE, early_leave_check_method TEXT,
  early_leave_check_result TEXT,                  -- 6か月以内離職の調査日・方法・結果
  type(t2p/pure/direct), phase(F1..F6),
  dispatch_assignment_id NULLABLE

job_seekers（求職管理簿の正本）
  id, tenant_id, staff_id NULLABLE(→staff参照),
  seeker_snapshot_id(→party_snapshots),
  name_enc, address_enc, birth_date_enc,           -- PII暗号化列
  desired_occupation TEXT NOT NULL,
  accepted_at DATE NOT NULL, valid_until DATE NOT NULL,
  pii_consent JSONB NOT NULL,                     -- 同意日/範囲/提供先
  status(active/placed/withdrawn),
  extras JSONB, retention_until DATE

fee_records（手数料管理簿の正本）
  id, tenant_id, referral_id,
  payer_snapshot_id(→party_snapshots),            -- 手数料支払者
  fee_type(uketsuke/todokede/jogen) NOT NULL,     -- 手数料種別
  amount_incl_tax NUMERIC NOT NULL,
  calc_basis_wage NUMERIC, calc_basis_rate NUMERIC, -- 計算根拠となった賃金・料率
  collected_at DATE,                              -- ★実際の徴収年月日（請求日ではない）
  correction_of NULLABLE(→fee_records),           -- 返金・訂正は新行で表現
  correction_reason TEXT,
  freee_invoice_ref, retention_until DATE          -- 徴収完了後2年

dispatch_ledger_entries（派遣元管理台帳の正本：モデル様式22項目を型付きで）
  id, tenant_id, dispatch_assignment_id, staff_id,
  worker_snapshot_id, client_snapshot_id,
  kyotei_taisho BOOL NOT NULL,                    -- 協定対象派遣労働者か否か
  mukikoyo BOOL NOT NULL, contract_period,        -- 無期/有期・契約期間
  over_60 BOOL NOT NULL,
  client_office TEXT, client_address TEXT, org_unit TEXT,
  dispatch_period, work_days TEXT, work_hours_start, work_hours_end,
  work_detail TEXT NOT NULL,                      -- 詳細業務
  responsibility_level TEXT,                      -- 責任の程度
  t2p_flag BOOL NOT NULL, t2p_matters TEXT,       -- 紹介予定派遣事項
  hakenmoto_sekininsha, hakensaki_sekininsha,
  overtime_terms TEXT,
  social_insurance JSONB NOT NULL,                -- 加入状況・未加入理由
  kyoiku_kunren JSONB,                            -- 教育訓練（日時・内容）
  career_consulting JSONB,                        -- キャリア相談
  koyou_antei_sochi JSONB,                        -- 雇用安定措置（聴取した希望含む）
  complaints JSONB,                               -- 苦情の申出・処理状況
  actual_vs_plan JSONB,                           -- 就業実績と契約の差異
  extras JSONB, retention_until DATE              -- 派遣終了後3年

dispatch_assignments（派遣就業）
  id, tenant_id, staff_id, company_id, t2p_flag,
  start_date, end_date, org_unit, teishokubi DATE,
  conditions_typed（就業条件明示書の法定項目を型付きで持つ別表）, extras JSONB
```

帳簿の様式Excel/PDF出力は上記テーブルからのビュー（`ledger.export`）。**法定必須項目→DB列→出力欄の3点マッピング表**（§12 M0のDone条件）を`legal/mapping/`に置き、100%対応を機械検査する。

### 4.3 スナップショット層（過去帳簿の表示不変性）

```
party_snapshots
  id, tenant_id, party_type(company/worker/tenant_self),
  party_ref_id, schema_version,
  snapshot JSONB NOT NULL,     -- 凍結コピー（名称・所在地・代表者・許可番号・担当者等）
  sha256, taken_at, taken_reason(job_order_accept/contract_approve/placement_confirm/...)
```

取得タイミング：**求人受理時・契約承認時・就職成立時**。帳簿・書類はマスタではなくスナップショットを表示する。

### 4.4 証拠層（LLM抽出の出典管理）

```
source_artifacts（原文の不変保存）
  id, tenant_id, source_type(email/pdf/slack_post/manual),
  source_uri, received_at,
  content_hash sha256, immutable_object_uri(GCS),  -- 本文・添付そのものの不変コピー
  pii_classification

fact_assertions（LLMの候補事実）
  id, tenant_id, subject_type, subject_id, field_path,
  candidate_value, source_artifact_id, source_locator,  -- 原文のどこから抽出したか
  extraction_method, model_version, confidence NUMERIC,
  verification_status(unverified/verified/rejected),
  verified_by(認証主体から導出), verified_at
```

確定ブロック条件：confidence閾値未満／複数資料の矛盾／出典なし → 該当書類は`incomplete`または`ambiguous`で停止。

### 4.5 法令層（YAMLではなく版管理されたルール・証拠グラフ）

```
legal_sources
  id, authority, title, source_url, published_at,
  effective_from, effective_to, sha256, retrieved_at,
  supersedes_source_id

legal_rules
  rule_key, version, legal_source_id, jurisdiction,
  trigger_schema, required_fields_schema,
  severity, deadline_policy_id, remediation,
  effective_from, effective_to

rule_sets
  version, status(draft/approved/retired),
  approved_by, approved_at, checksum

template_versions
  doc_type, locale, jurisdiction,
  rule_set_version, template_version,
  effective_from, effective_to, checksum

deadline_policies（期限は日付でなくポリシーで持つ）
  id, key, trigger_event, calculation_method,
  legal_or_internal(legal/internal_target),
  jurisdiction, effective_from, effective_to

obligation_evidence（Vantaパターン：義務↔証拠の紐付け）
  obligation_key, subject_id,
  evidence_type(document/ledger_row/artifact),
  evidence_ref, acquired_at, acquired_from
```

**過去書類の再現性**: 各documentは`rule_set_version`＋`template_version`＋入力スナップショットhashを持ち、法改正後も改正前の書類を再現できる。

### 4.6 承認・監査層

```
approval_requests（承認＝認証済みイベント。承認者名はツール入力で受け取らない）
  id, tenant_id,
  subject_type, subject_id, subject_version,
  requested_action,
  artifact_sha256,          -- 承認対象PDFのハッシュ
  proposed_diff,
  required_role,
  requested_by, requested_at,
  nonce, expires_at,
  approved_by,              -- OAuth token subject / Slack署名済みpayload / SSO principalから導出
  approved_at, decision(approved/rejected/expired), decision_reason

audit_events（改ざん困難なハッシュチェーン）
  event_id, tenant_id,
  aggregate_type, aggregate_id, aggregate_version,
  event_type,
  before_hash, after_hash,
  actor_principal_id, actor_role, auth_method,
  request_id, trace_id, source_ip_or_runtime,
  occurred_at,
  previous_event_hash, event_hash    -- チェーン。UPDATE/DELETE権限をruntimeロールから剥奪
```

高リスク操作の追加統制：作成者≠承認者（職務分離）／承認後に1バイトでも変われば承認無効（hash不一致で自動void）／訂正理由必須／一定金額以上・法的例外案件は二者承認。

実行済み書類ごとに保存するハッシュ束：承認済み生成PDFのSHA-256、署名済み正本（紙スキャン/電子署名）のSHA-256、template_version、rule_set_version、入力スナップショットhash、生成モデル・プロンプト構成の版、交付先・交付時刻・メッセージID。

### 4.7 テナント・PII（Phase 0から実装）

- 全テーブル`tenant_id`＋RLS。テナント跨ぎのFK・検索を禁止
- ツールごとのOAuth scope（read系/write系/approve系を分離）
- 本番・検証・開発のサービスアカウント分離
- 添付ファイルのウイルス・MIME・サイズ検査
- 保存期限後の削除ジョブ＋`legal_hold`（retention_status参照）
- データエクスポート・削除要求の記録テーブル
- MCP仕様準拠：トークンaudience検証必須、token passthrough禁止、ログ通知にPII・秘密・内部情報を含めない

---

## 5. 状態機械（単一statusを5系統に分解）

```
content_status   : draft → under_review → approved → superseded / voided
execution_status : unsigned → partially_signed → executed
delivery_status  : not_sent → queued → sent → delivered / failed
ledger_status    : unposted → posted → corrected
retention_status : active → eligible_for_deletion → legal_hold → deleted
```

これにより「承認済みだが未署名」「紙で署名済みだがスキャン未登録」「交付したがバウンス」「訂正版を再交付」「記帳済みだが請求未発行」を正確に区別する。documentsテーブルはこの5列を持ち、遷移はすべてaudit_eventsに記録。

---

## 6. 処理パイプライン（LLMと法令判定の分離）

```
① 原文の不変保存（source_artifacts：hash＋GCSコピー）
        ↓
② LLMによる候補事実の抽出（fact_assertions：出典位置・confidence・矛盾提示・欠落列挙）
        ↓
③ 人間確認（verification_status=verified。MCP App画面 or Slack署名済みボタン）
        ↓
④ 確認済み事実に対する決定論的ルール判定（legal_rules→findings。LLM非介在）
        ↓
⑤ 書類生成（template_versions）→ 承認 → 署名 → 交付 → 記帳（各状態機械）
```

LLMの担当は**抽出・出典記録・信頼度付与・矛盾提示・欠落列挙のみ**。法律判定・条項選択・期限計算はすべて決定論的コード。

---

## 7. MCPツール一覧 v2（1ツール1ジョブ・read/write分離）

### 共通仕様

書込系ツールの必須入力：`idempotency_key`, `expected_subject_version`, `reason`
共通レスポンス封筒：`operation_id, subject_id, subject_version, status, missing_fields[], findings[], evidence_refs[], next_actions[]`
アノテーション：`readOnlyHint / destructiveHint / idempotentHint / openWorldHint` を全ツールに正しく付与。外部送信・Drive共有・freee作成は`openWorldHint=true`とし、必ずプレビュー→確認を挟む。

### ツール表

| 群 | ツール | 種別 | 内容 |
|---|---|---|---|
| 取込 | `job_order.analyze` | read | 原文→source_artifacts保存＋fact_assertions生成＋欠落列挙。**DB確定記帳しない** |
| | `job_order.confirm` | write | 検証済み事実からjob_orders確定＋帳簿posting |
| | `job_seeker.analyze` / `job_seeker.confirm` | read/write | 同上（求職側） |
| 書類 | `document.preview` | read | 生成前プレビュー（差込値・出典・充足状況） |
| | `document.generate_draft` | write | draft生成（GCS保存＋documents行） |
| | `document.request_approval` | write | approval_requests作成（hash・nonce・期限つき） |
| | `document.approve` | write | 承認。**actorは認証主体から導出。入力で承認者名を受けない** |
| | `document.attach_executed_copy` | write | 署名済み正本（スキャン/電子署名）の添付＋hash登録 |
| | `document.record_delivery` | write | 交付記録（方法・日時・電子交付同意・メッセージID） |
| | `document.supersede` | write | 訂正版発行（理由必須・旧版はsuperseded） |
| 成立 | `placement.confirm` | write | 就職成立＋帳簿③posting（referral採否・採用日・禁止期間自動設定） |
| | `invoice.create_draft` | write(openWorld) | freee請求ドラフト（外部処理はoutbox経由） |
| 判定 | `compliance.evaluate` | read | 単一subjectの決定論ルール判定→findings（5値） |
| | `finding.resolve` | write | finding解消（是正内容・証拠必須） |
| 報告 | `report.start` / `report.status` / `report.result` | task | 様式8/11・マージン率の集計ジョブ（Tasks＋pollingフォールバック） |
| 出力 | `ledger.export` | read | 帳簿①②③・台帳の様式出力 |

### Resources（ToolでなくResourceで公開する参照系）

```
chobo://legal-rules/{rule_key}/{version}
chobo://templates/{doc_type}/{locale}/{version}
chobo://documents/{logical_document_id}/{version}
chobo://findings/{finding_id}
chobo://reports/{report_id}
chobo://audit/{subject_type}/{subject_id}
```

一覧・ページネーション・更新購読はMCP Resources仕様に従う。

### MCP App（承認画面）

Slackの✅リアクションでは承認要件を満たさない。承認UIは次のいずれか：
1. **MCP App（推奨）**: sandboxed iframeで、生成PDFプレビュー／前版差分／法定必須項目の充足状況／各値の出典（source_locatorへのリンク）／confidence・矛盾／未解決findings／承認後に起こる処理、を一画面表示。操作は承認・差戻し・訂正・署名済みコピー添付。業務データはサーバー側に保持し、UIは一時状態のみ
2. **Slack署名済みinteractionボタン**: 承認対象のPDFハッシュ・差分・nonce・期限・actor IDを結び付けたボタン（✅絵文字は通知用途のみ）

---

## 8. 法令追従運用（Choboの堀の本体）

```
変更検知 → 差分作成 → 影響対象の列挙 → 社労士等レビュー → テスト環境
→ 二者承認 → 発効日指定 → 本番化 → 既存案件の再スキャン
```

- 監視対象：厚労省の派遣業務取扱要領・職業紹介事業関係の公式URL群を**週次差分監視**（sha256比較）。改正予告が出た場合は日次に切替
- **初回の実戦**: 派遣業務取扱要領の**2026年10月1日適用版への改正が既に予告済み**。M2完了までにこの改正をlegal_sources→legal_rules差分→再スキャンの一連で処理し、追従パイプラインの実地検証とする
- changelogは顧客向け価値（「〇月改正対応済み」）として外販時にそのまま使う

---

## 9. 期限モデル

期限は日付をコードに埋めず、deadline_policiesで表現する。

| key | trigger | calculation | 区分 |
|---|---|---|---|
| form8_submit | 年度末 | 翌年度4/30 | legal |
| form11_submit | 事業年度終了 | 令和8年分は6/1〜6/30の提出期間 | legal |
| margin_disclosure | 事業年度終了 | **可能な限り速やかに**（法定） | legal |
| margin_disclosure_target | 事業年度終了 | 7/10 | internal_target |
| t2p_review_4m | T2P開始 | ＋4か月：転換方針確認 | internal_target |
| t2p_review_5m | T2P開始 | ＋5か月：直接雇用条件・不採用時手順確認 | internal_target |
| t2p_limit_6m | T2P開始 | ＋6か月：**延長不可のblocking finding** | legal |
| t2p_closeout | T2P終了 | 採用/不採用/辞退理由の証拠回収 | legal |
| ledger_retention | 帳簿完結 | ＋2年（紹介）/＋3年（派遣台帳） | legal |

deadline_instances（policy×subjectの実期限）はR1朝ダッシュボードに供給。

---

## 10. 三層との接続（既存運用への配線）

- **Slack**: #10_deal_desk＝求人取込の入口（job_order.analyze）、#20_派遣管理＝承認・期限（approval通知・R1連携）、#90_dev＝開発
- **GCS**: `gcs_object_registry`にChobo文書を登録（lifecycle=audit）。immutable copyはバケットのretention lock検討
- **Drive**: 既存命名規則（L1通称/L2 YYYYMM/L3 NAME）で派生コピーを配置
- **freee**: invoice.create_draftはoutbox→worker→freee API。既存freee-invoice-csvスキルの計算ルールを流用
- **AIOS gateway**: 既存PDF生成ツールの流用は、ツール名変動中のため実機で一覧取得後に判断（M1タスク）

---

## 11. マイルストーン v2（レビュー§8の順序を採用）

| 段階 | 実装内容 | Done条件（客観ゲート） |
|---|---|---|
| **M0 基盤**（〜4週） | 法定項目マトリクス、型付きスキーマ＋RLS、party_snapshots、legal_sources/rules/rule_sets/template_versions、認証・RBAC、audit_eventsハッシュチェーン、outbox | **全法定項目がDB列・証拠・出力欄へ100%マッピング**され、匿名化実例（あずま園型）で再現できる。監査イベントのチェーン検証が通る |
| **M1 縦切り1本**（〜8週） | 求人メール→analyze→人間確認→confirm（帳簿①②）→document draft→承認→署名済み版添付→交付ログ、の1本を通す。書類は労働条件通知書＋④のみ | 一案件の全操作がactor・時刻・版・ハッシュ付きで追跡可能。approval_requestsのnonce/hash/期限が機能 |
| **M2 T2P**（〜14週） | T2P全書類（⑤⑥⑦⑧⑨⑩）、派遣3点（A2/A3/A10/台帳）、期限イベント（4m/5m/6m/closeout）、採否理由チェーン、手数料③、freee連携、**2026-10-01要領改正の追従実戦** | F1〜F6を、訂正・失敗・不採用を含むシナリオテストで通過。6か月blocking findingが実動 |
| **M3 報告・外販準備**（〜20週） | 様式8/11・マージン率集計、監査エクスポート、テナント分離検証、バックアップ復旧、MCP新旧プロトコル互換、golden promptテスト | 帳簿との数値照合一致、復旧試験成功、PIIログ検査ゼロ、権限侵入テスト（テナント越境ゼロ）、法的意見書完了 |

### 外販βの客観ゲート（「3か月無事故」に追加）

- [ ] 各主要フロー（純紹介・T2P・派遣）の最低運用件数達成（目安：各5件以上）
- [ ] 訂正・再交付・不採用を含む実績あり
- [ ] 100%の承認操作追跡（audit抜き打ち検査）
- [ ] 100%の法定必須項目充足（機械検査）
- [ ] バックアップ復元成功
- [ ] テナント越境テスト失敗ゼロ
- [ ] ログPII検査ゼロ
- [ ] 最新法令版との差分ゼロ（legal_sources監視の実績）
- [ ] 社労士意見書取得（§3.2の9論点）
- [ ] DB分離（別インスタンス）完了

---

## 12. テスト戦略

- ツール単体テスト（idempotency：同一keyの再実行で副作用1回）
- MCP Inspectorでのschema・アノテーション検証
- **golden promptテスト**：直接指示・間接指示・否定形（「〜しないで」）の3系統で、モデルが正しいツール列を選ぶことを回帰確認
- OAuth失敗系（期限切れ・scope不足・audience不一致）
- RLS侵入テスト（テナント越境クエリが全て失敗すること）
- 状態機械の不正遷移テスト（approved後の内容変更→承認自動void等）
- 復旧試験（PITRからの復元→audit chainの再検証）

---

## 13. リポジトリ構成 v2

```
sugukuru-aios/apps/compliance/
  src/
    protocol/            ← MCPアダプタ（2025-11-25 / 2026-07-28）
    tools/               ← §7の各ツール（1ファイル1ツール）
    resources/           ← chobo:// リソースハンドラ
    apps/approval-ui/    ← MCP App（承認画面）
    services/            ← stateless application services
      extraction/        ← LLM抽出（fact_assertions生成）
      rules/             ← 決定論的ルールエンジン（LLM非介在）
      documents/         ← 生成・版管理
      outbox-worker/     ← GCS/Drive/Slack/freee反映
    db/
      schema/            ← Drizzle（§4の全テーブル）
      rls/               ← RLSポリシー
      migrations/
    legal/
      sources/           ← legal_sourcesのシード・監視設定
      rules/             ← ルール定義（DBへロードする原稿。直接参照しない）
      mapping/           ← 法定項目マトリクス（項目→列→出力欄の3点対応表）
      templates/         ← docx/HTMLテンプレ（template_versions管理下）
    audit/               ← ハッシュチェーン・検証CLI
  test/
    fixtures/            ← 匿名化実例
    golden-prompts/
  README.md              ← 本設計書v1を正とする実装ガイド
```

**実装順（Cursor向け）**: schema＋RLS＋audit chain → outbox → protocol adapter → job_order.analyze/confirm縦切り → approval_requests＋MCP App → 以降ツール横展開。**テンプレートを増やすのは基盤完成後**（レビューの最重要指摘）。

---

## 14. 残る要決定事項（3件のみ）

1. **MCP App vs Slackボタンの優先順**：承認UIはMCP Appを本命としつつ、社内はSlack導線が強い。M1ではSlack署名済みボタンで開始し、M2でMCP Appに寄せる、で良いか（壁判断）
2. **AIOS gateway既存PDFツールの流用範囲**：実機のツール一覧取得後に、流用/内製の線引きを決定（イクバル＋壁、M1冒頭）
3. **外販時の課金モデル詳細**：基本月額＋従量の従量単位（書類数/案件数/席数）。β顧客のWTP検証後に確定

---

## 付録A. v0レビュー指摘 → v1反映対応表

| レビュー | v1反映先 |
|---|---|
| P0-1 帳簿スキーマ完成・型付き列・snapshot | §4.2・§4.3 |
| P0-2 LLMと法令判定の分離 | §4.4・§6 |
| P0-3 版管理されたルール・証拠グラフ | §4.5・§8 |
| P0-4 状態機械の分解 | §5 |
| P0-5 承認の認証済みイベント化 | §4.6・§7 |
| P0-6 改ざん困難な監査ログ | §4.6 |
| P0-7 outbox・正本階層 | §2.1・§2.2 |
| P0-8 テナント・PII分離 | §4.7・§2.3 |
| ツール再設計（1ツール1ジョブ） | §7 |
| Resources / MCP App | §7 |
| プロトコル互換（2026-07-28 RC） | §2.4 |
| マージン率の期限区別・deadline_policy | §9 |
| T2P期限イベント | §9 |
| 社労士法の製品境界拡張 | §3 |
| マイルストーン再編・客観ゲート | §11 |
| テスト（golden prompt等） | §12 |

## 付録B. 参照

- Chobo設計書v0ドラフト（2026-07-22）およびv0レビュー（米国先行例・MCP公式仕様・厚労省現行資料との突合、2026-07-22受領）
- スグクル_必要書類リスト_日英_v1／紹介予定派遣_実務フロー_v1／派遣6ヶ月超_純紹介切替_実務フロー_v1
- リサーチレポート「法定書類自動作成MCPアプリ: 設計・事業戦略」（2026-07）
- sugukuru-data-dictionary v4.1（三層モデル・R1-R8）

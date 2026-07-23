# レジストリ公開レディネスチェックリスト / Registry Publication Readiness Checklist / Checklist Kesiapan Publikasi Registry

## 目的・前提 / Purpose & premise / Tujuan & premis

このドキュメントは「Assenを公式MCPレジストリ（Anthropicコネクタディレクトリ・ChatGPT Appsマーケットプレイス等）へ提出する」ために必要な作業を、
①**すでにコードレベルで整備済み**、②**エンジニアだけでは決められない意思決定**、③**設計書§11のM2/M3客観ゲート（必須・未達成）**の3種類に分けて管理します。

このドキュメントは**登録申請のGoを意味しません**。設計書v1 §11・24行目の方針どおり、**外販β・レジストリ公開申請はM3の客観ゲート通過後**に限ります。現在のマイルストーンはM1完了・M2 Phase 1（基盤整備＋派遣3点書類A2/A3/A10＋A4台帳）・M2 Phase 2（T2P書類④〜⑨＋採否理由チェーン）着手済みです。詳細は下記C節参照。

This document tracks the work needed to submit Assen to a public MCP registry (Anthropic connector directory,
ChatGPT Apps marketplace, etc.), split into three kinds: (1) infrastructure already prepared at the code level,
(2) decisions that require business/legal judgment, not just engineering, and (3) the M2/M3 objective gates from
design doc §11 (mandatory, not yet met). This document does **not** authorize submission — per design doc v1 §11
(line 24), public-registry submission happens only after passing M3's objective gate. The current milestone is
M1 complete, M2 not started.

Dokumen ini melacak pekerjaan yang diperlukan untuk mengajukan Assen ke registry MCP publik (direktori konektor
Anthropic, marketplace ChatGPT Apps, dll.), dibagi menjadi tiga jenis: (1) infrastruktur yang sudah disiapkan di
level kode, (2) keputusan yang membutuhkan penilaian bisnis/hukum, bukan hanya teknik, dan (3) gate objektif
M2/M3 dari dokumen desain §11 (wajib, belum terpenuhi). Dokumen ini **tidak** mengotorisasi pengajuan — sesuai
dokumen desain v1 §11 (baris 24), pengajuan registry publik dilakukan hanya setelah lolos gate objektif M3.
Milestone saat ini adalah M1 selesai, M2 belum dimulai.

---

## A. 今回整備済み（コードレベルの下準備） / Prepared in this pass (code-level groundwork) / Disiapkan pada sesi ini (dasar level kode)

これらはM2/M3ゲートとは独立に、公開の障害を先に取り除くために行った作業です。

| 項目 / Item / Item | 内容 / Details / Detail |
|---|---|
| OAuth2 Bearer検証 | `src/lib/auth.ts`にJWKS/issuer/audience検証・role/tenantクレームマッピングを実装（`jose`使用、`OAUTH_ISSUER`/`OAUTH_AUDIENCE`/`OAUTH_JWKS_URI`/`OAUTH_ROLE_CLAIM`/`OAUTH_TENANT_CLAIM`で設定）。token passthroughは行わない |
| CORSポリシー | `src/lib/cors.ts`。discoveryエンドポイント（`/health`・`/ready`・`/.well-known/mcp.json`）は全origin許可、`/mcp`は既定でCORS無効、`CORS_ALLOWED_ORIGINS`で明示許可したoriginのみ許可 |
| Server Card整備 | `repository`/`contact`/`documentation`/`license`欄を追加。実在しないURLは**捏造せずnullを返す**（`SERVER_CARD_REPOSITORY_URL`/`SERVER_CARD_CONTACT_URL`未設定時） |
| 本番向けDockerfile | `Dockerfile`（`runtime`/`migrator`の2ターゲット、マルチステージ、非rootユーザー実行）。ローカルDocker buildで実際に起動・マイグレーション適用まで動作確認済み |
| GitHub Actions CI | `.github/workflows/ci.yml`（lint/typecheck/test/legal:check-mapping/audit:verify/build、Postgres+MinIOを使った統合テスト、Dockerビルド検証） |
| LICENSE・SECURITY.md | 既定は「全著作権留保」（ライセンス方針が決まるまでの安全側デフォルト）。SECURITY.mdの連絡先はTODOプレースホルダ（下記B参照） |
| **本番実行パスの不具合修正** | `npm run build`後の`node dist/server.js`が実際には存在しないパスだった（実際は`dist/src/server.js`）ことと、`legal/`配下のJSON/テンプレート読込ロジックが固定階層の相対パスに依存しdist実行時に破綻することを検出・修正（`src/lib/project-root.ts`で祖先探索に変更）。Dockerコンテナを実際に起動し、`document.generate_draft`が使う`legal-mapping-loader`/`render-template`がdistから正しく読めることを確認済み |
| outbox workerの実行環境 | cross-tenantポーリングループ（`listActiveTenantIds`/`processOutboxBatchForAllTenants`）・CLIエントリポイント（`src/services/outbox-worker/run.ts`、`pnpm run outbox:worker`）・Dockerfileの`outbox-worker`ターゲットを新規作成。ローカルでビルド・起動・SIGTERM停止まで実機確認済み。**M2でeventType handlerを登録するまで本番スケジューラへ接続しないこと**（README「本番運用への残課題」参照） |
| テストスイートの汚染防止 | `transactional_outbox`はグローバルFIFOでpending行を取得するため、テストが自分の行を削除せずに残すと将来の実行で無関係な行を巻き込む不具合があった。`vitest.config.ts`に`fileParallelism: false`を設定し、`test/outbox*.test.ts`にafterAllでの行削除を追加して解消 |
| RLSの実効性検証 | ローカル開発ロール（`assen`）がsuperuserでRLSを完全にバイパスしていたことを発見。非superuser・RLS強制の`assen_app`ロールを新規作成し、migration専用の`MIGRATION_DATABASE_URL`と分離。`audit_events`のハッシュチェーン直列化を`SELECT ... FOR UPDATE`から`pg_advisory_xact_lock`へ変更（UPDATE権限剥奪と両立するため）。既存テスト・CIを`assen_app`経由へ統一し、クリーンなDockerボリュームからの再構築でも全45テストが通ることを実地確認済み。詳細は下記D節「テナント分離検証」参照 |
| golden promptハーネス | `src/services/golden-prompts/`（ツールカタログ取得・選択器の型・実行エンジン）と`test/golden-prompts/`（M2 Phase 2で追加した4新規ツール分を含め計44件のフィクスチャ、CLIエントリポイント`pnpm run golden-prompts:run`）を新規作成。直接指示・間接指示・否定形の3系統で全14ツールをカバー。現時点ではheuristicスタブでの配線検証のみ（実LLMでの正答率検証は未実施、下記D節参照） |
| バックアップ復元ドリル | `scripts/db-backup.sh`／`scripts/db-restore-drill.sh`／`scripts/db-restore.sh`／`scripts/drill-demo-data.ts`を新規作成。ローカルDocker Composeの`assen`データベースで実際に復元ドリルを実行し、行数一致・GRANT維持・audit chain検証・実際の`assen`データベースのdrop→recreate→restore後の全テストスイート通過まで実地確認済み。詳細は下記D節「バックアップ復旧」参照 |
| MCP新旧プロトコル互換テスト | `src/server.ts`から`createAssenHttpServer()`を切り出し、実際にHTTPサーバーを起動して`initialize`のprotocolVersionを変えて送る回帰テスト（`test/protocol-version-compat.test.ts`）を新規作成。SDKが対応する全5バージョンでの成功と、未対応バージョン（`2026-07-28` RC）を送っても安全にフォールバック応答することを実地確認済み。詳細は下記D節参照 |
| **monorepo統合（パス移設）** | 設計書§2.3の決定（下記B節参照）どおり、単独リポジトリだったAssenを`aios`リポジトリの`apps/compliance/`へ実際に移設した。GitHub Actionsのワークフローはリポジトリルートの`.github/workflows/`にしか置けない仕様のため、元の`.github/workflows/ci.yml`は`aios/.github/workflows/compliance-ci.yml`として`paths: ["apps/compliance/**"]`フィルタ＋`working-directory: apps/compliance`付きで再作成し、Dockerビルドは`docker build -f apps/compliance/Dockerfile ... apps/compliance`（コンテキストを`apps/compliance`に限定）へ調整した。データ層（Postgres/audit_events/approval_requests）はAIOSのSupabase/BigQuery/Approved Action Executorとは意図的に統合していない（別進行、下記参照）。移設後、新しい場所で`typecheck`/`lint`/`test`/`build`が実際に通ることを確認済み |
| **M2 Phase 1：基盤整備＋派遣3点書類（A2/A3/A10）＋A4台帳自動記帳** | ④〜⑩・A2/A3/A4/A5/A10の正式な書類名定義がリポジトリのどこにも存在しなかったため、v0ドラフトから[`docs/document-catalog.md`](document-catalog.md)へ正式インポート（壁承認済み、社労士レビューは未実施）。`dispatch_assignment.confirm`ツールを新規実装し、派遣就業確定と同時にA4派遣元管理台帳（`dispatch_ledger_entries`）へ自動記帳する（`job_order.confirm`と同型パターン）。`document.generate_draft`/`document.preview`/`compliance.evaluate`を`docType`単位の汎用ルーター（`src/services/documents/doc-type-registry.ts`）へリファクタし、既存`labor_conditions_notice`に加えA2（`dispatch_individual_contract`）・A3（`dispatch_working_conditions_notice`）・A10（`dispatch_worker_notice`）の3docTypeを追加。テンプレート・mapping項目は`operations/registries/template_registry/`の既存様式（A2/A10は`{{field}}`差込済み・A3は空欄様式）を転記・変換したもので、法的文言は創作していない。既存59件超のテストスイート（`assen_app`ロール・RLS強制下）全通過を確認済み。**T2P書類④〜⑩・期限イベント・採否理由チェーン・手数料③・freee連携・法改正追従は本フェーズ対象外**（下記C節参照） |
| **M2 Phase 2：T2P書類④〜⑨＋採否理由チェーン（`placement.confirm`）** | 実務フローv1（社外・未レビュー）の調査により、④⑤⑦⑧⑨の被評価主体（subject）を新規テーブル`job_order_referrals`とし、⑥はA2と同じ`dispatch_assignments`（`t2pFlag`）を再利用する構成を確定。⑦⑧⑨の生成には採否決定の記録が前提となるため、別項目として提示していた「採否理由チェーン・`placement.confirm`」を本フェーズへ統合（壁承認済み）。⑩直接雇用切替同意書はテンプレート不在・実務フローv1に記載なしのためスコープ外（[`docs/document-catalog.md`](document-catalog.md)に注記のみ、壁承認済み）。新規ツール4件（`job_seeker.confirm`＝帳簿②postingとPII暗号化、`job_order_referral.confirm`＝帳簿①②紹介欄posting、`placement.confirm`＝採否確定・転職勧奨禁止期間の自動計算・帳簿③posting・party snapshot、`placement.record_rejection_reason`＝不採用理由の記録）を実装し、`doc-type-registry.ts`の`subjectType`を`"dispatch_assignment" \| "job_order_referral"`のunion型へ拡張、`generate-draft.ts`/`preview.ts`/`compliance.evaluate`/`subject-lookup.ts`を`subjectType`分岐に一般化（`dispatchAssignmentId`→`subjectId`）。`job_order_referrals`テーブルへ`conditionsTyped`（JSONB）・`rejectionReason`・`rejectionReasonReceivedAt`列を追加するマイグレーションと、`party_snapshots.taken_reason`への`job_seeker_accept`追加も実施。F1〜F6の縦切り統合テスト（`test/m2-phase2-t2p-documents.test.ts`、hired/rejected両ルート）を新規追加し、既存の全テストスイート（golden-prompts含む）が通過することを確認済み。**A5（派遣先台帳雛形）・手数料③の計算ロジック精緻化・`invoice.create_draft`・freee連携・2026-10-01要領改正の追従・社労士による④〜⑨の法的レビューは本フェーズ対象外**（下記C節参照） |
| **独立リポジトリ化（`aios`からの再切り出し）** | `aios`モノレポ内`apps/compliance/`での開発（M1〜M2 Phase 2）を経て、`sugukurukabe/assen`として再度独立したpublicリポジトリへ切り出した。`git subtree split`で3コミットの履歴を保持したまま抽出し、`git filter-repo --replace-text`で実在のGCPプロジェクトID・プロジェクト番号・OAuth Client ID・SlackチャンネルID・許可番号を全履歴からプレースホルダーへ置換した（コミット作者名・emailはgit本来の属性情報のため対象外）。CIワークフロー（旧`compliance-ci.yml`/`compliance-deploy.yml`）はリポジトリルート直下の`ci.yml`/`deploy.yml`へ配置し直し、GCPプロジェクトID・WIFプロバイダ・サービスアカウントはワークフローYAMLへ直書きせずGitHub Secretsへ外出しした（WIFの安全性自体はこれらの値の秘匿性に依存しないが、公開リポジトリでの偵察面を減らすため）。`aios`側の`apps/compliance/`・関連workflowは削除済み |

---

## B. 意思決定が必要（エンジニアリングだけでは決められない） / Decisions required (beyond engineering) / Keputusan yang diperlukan (di luar teknik)

これらは壁（Admin）またはビジネス側の判断が必要です。コードは決定後すぐに反映できる形（環境変数・設定ファイル）にしてあります。

| 項目 / Item / Item | 現状 / Current state / Status saat ini | 決定が必要な内容 / What must be decided / Apa yang harus diputuskan |
|---|---|---|
| リポジトリの配置 | **完了**：`aios`リポジトリの`apps/compliance/`へ実際に移設した（上記A節「monorepo統合」参照）。ブランチ`feat/apps-compliance-assen-migration`上での作業で、`aios`の`main`へのマージ・PR起票はまだ行っていない | 統合先ブランチ・PRのマージタイミングは壁の判断（このリポジトリは本番デプロイ中のため） |
| ライセンス方針 | `LICENSE`は「全著作権留保」の暫定既定値 | 公開製品として外販するか、OSSライセンス（例: suguvisa-mcpの前例があればそれに合わせる）を採用するかを決定 |
| セキュリティ報告窓口 | `SECURITY.md`は「Slack `#30-dev`」のプレースホルダ | 外部提出前に実在する監視可能な連絡先（メール/フォーム）へ更新 |
| Server Cardのrepository/contact実値 | `SERVER_CARD_REPOSITORY_URL`/`SERVER_CARD_CONTACT_URL`は未設定（null出力） | 実際のURL確定後に環境変数へ設定 |
| OAuthプロバイダの確定方式 | **決定・実装・E2E確認済み**：(b)トークン交換層方式を採用し実装（`src/lib/token-exchange.ts`、上記G節参照）。本番署名鍵・issuer・実`GOOGLE_OAUTH_CLIENT_ID`を設定済みで、実際のGoogle Workspaceログイン→Assen JWT→MCP呼び出し成功まで確認済み（2026-07-24、[`docs/ops-runbook.md`](ops-runbook.md)6.2節参照）。allowlist（`TOKEN_EXCHANGE_ALLOWLIST_JSON`）は現時点でコード管理の環境変数のみ（`admin@example.co.jp`のみ登録）で、Workspace管理コンソールとの連携はしていない | メンバー追加時のallowlist更新運用の確立（現状は壁への手動依頼）。ネットワーク層の追加防御（IAP/VPN）は未実施 |
| 外販時のDB分離 | Phase 0はaios-pg同居を条件付き許容（設計書§2.3） | 外販β開始時は別Cloud SQLインスタンス（可能なら別GCPプロジェクト）へ分離する方針は決定済み。実施タイミングの確定が必要 |
| 法的意見書の依頼 | **送付前ドラフト作成済み**：[`docs/legal-review-request-draft.md`](legal-review-request-draft.md)に、高平さん（行政書士）への紹介依頼文面と、社労士への第1バッチ（労働条件通知書・A2/A3/A10）依頼文面（設計書§3.2の9論点を明記）を用意した。**実際の送信はこのセッションでは行っていない** | 壁が文面を確認・調整のうえ実際に送付し、意見書受領後に[`docs/document-catalog.md`](document-catalog.md)・テンプレート・本項目を更新する |

---

## C. M2ゲート：T2P（Phase 1着手・公開の前提条件） / M2 gate: T2P (Phase 1 in progress; a precondition for publication) / Gate M2: T2P (Phase 1 sedang berjalan; prasyarat publikasi)

設計書§11より（〜14週想定）。M2は7項目に分かれ、Phase 1で最初の1項目（基盤整備＋派遣3点書類）に着手した。

- [~] T2P全書類（④求人条件明示書・⑤本人同意書・⑥T2P個別契約書・⑦転換条件覚書・⑧不採用理由請求・⑨不採用理由通知・⑩直接雇用切替同意書）の生成 — **Phase 2で④〜⑨に着手**（上記A節「M2 Phase 2」参照）
  - [x] `job_seeker.confirm`（求職者確定・PII暗号化・帳簿②posting）／`job_order_referral.confirm`（紹介行確定・帳簿①②紹介欄posting）ツール
  - [x] ④求人条件明示書・⑤本人同意書のdomain schema・テンプレート・mapping・`compliance.evaluate`対応（`job_order_referral.confirm`確定直後に生成可能）
  - [x] ⑥T2P個別契約書（A2と同じ`dispatch_assignments.conditionsTyped`を`t2pFlag=true`時に再利用する方式で実装）
  - [x] ⑦転換条件覚書（`placement.confirm`のhiredルートで生成可能）・⑧不採用理由の明示請求（`placement.confirm`のrejectedルートで生成可能）・⑨不採用理由の書面明示（`placement.record_rejection_reason`後に生成可能）
  - [x] ⑩直接雇用切替同意書は**スコープ外**と確定（テンプレート不在・実務フローv1に記載なし。[`docs/document-catalog.md`](document-catalog.md)に注記、壁承認済み）
  - [ ] 社労士による法的レビュー（④〜⑨のテンプレート・必須項目の正確性）は未実施
  - [ ] `document.request_approval`→`document.approve`→交付の縦切り一本を、新docType（④〜⑨）で実際に通すE2Eシナリオテストは未実施（`m2-phase2-t2p-documents.test.ts`はconfirm→generate_draft/previewまでで、承認・交付フローは対象外）
- [~] 派遣3点（A2/A3/A10/台帳）の生成 — **Phase 1でエンジニアリング部分に着手**（上記A節「M2 Phase 1」参照）
  - [x] `dispatch_assignment.confirm`ツール（派遣就業確定＋A4派遣元管理台帳の自動記帳）
  - [x] A2（個別契約書）・A3（就業条件明示書）・A10（派遣先通知）のdomain schema・テンプレート・mapping・`compliance.evaluate`対応
  - [ ] A5（派遣先台帳雛形）は未着手（要否は次フェーズで判断、[`docs/document-catalog.md`](document-catalog.md)参照）
  - [ ] 社労士による法的レビュー（テンプレート・必須項目の正確性）は未実施
  - [ ] T2P（紹介予定派遣）時のA3 `t2pDisclosure`・A10 `periodLimitExceptionCategory`等の条件分岐ロジックは未実装（現状は任意項目としてスキーマ上受け付けるのみ）
  - [ ] `document.request_approval`→`document.approve`→交付の縦切り一本を、新docType（A2/A3/A10）で実際に通すE2Eシナリオテストは未実施（既存M1ゲートテストはlabor_conditions_noticeのみ）
- [ ] 期限イベント（4か月/5か月/6か月/closeout）の実装
- [x] **採否理由チェーンの実装**：`placement.confirm`（採否確定。hired時は転職勧奨禁止期間＝採用日+2年を自動計算し、party snapshot作成＋帳簿③`fee_records`へposting。rejected時は⑧書類生成に必要な項目を記録）と`placement.record_rejection_reason`（派遣先からの回答受領後、不採用理由をtyped columnへ記録し⑨生成の前提を整える）を実装。hired/rejected両ルートを`test/m2-phase2-t2p-documents.test.ts`で検証済み
- [~] 手数料③の計算・記録 — **`placement.confirm`のhiredルートで`fee_records`へのposting自体は実装済み**（帳簿③、`feeType`/`amountInclTax`/`calcBasisWage`/`calcBasisRate`/`collectedAt`）。手数料額そのものの計算ロジック（賃金・成約時期に応じた算定式）の精緻化は未着手（呼び出し側が算定済みの金額を渡す前提）
- [ ] freee連携（`invoice.create_draft`等。`fee_records`へのposting止まりで請求書生成は未着手）
- [ ] **2026-10-01 派遣業務取扱要領改正**の追従実戦（legal_sources→legal_rules差分→再スキャンの一連を実地検証）

**Done条件（客観ゲート）**：F1〜F6を、訂正・失敗・不採用を含むシナリオテストで通過。6か月blocking findingが実動。

---

## D. M3ゲート：報告・外販準備（未着手・公開の前提条件） / M3 gate: reporting & external-beta readiness (not started; a precondition for publication) / Gate M3: pelaporan & kesiapan beta eksternal (belum dimulai; prasyarat publikasi)

設計書§11より（〜20週想定）。

- [ ] 様式8/11・マージン率集計
- [ ] 監査エクスポート
- [x] **テナント分離検証（エンジニアリング部分）**：outbox worker実装（`processOutboxBatchForAllTenants`）の調査で、ローカル開発DBロール（`assen`）が`rolsuper=true`かつ`rolbypassrls=true`（superuser）であることを発見。以下の対応を完了し、非superuserロールでRLSが実際に強制されることを確認済み：
  - `assen_app`（非superuser・RLSバイパスなし）ロールを新規作成し、アプリ/テストの`DATABASE_URL`をこちらに変更。マイグレーション/GRANT専用に`MIGRATION_DATABASE_URL`（superuser相当）を分離（`src/db/migrate.ts`）
  - `docker/initdb/01-create-runtime-role.sql`（ローカル自動作成）・`src/db/rls/002_grant_runtime_role.sql`（GRANT。`audit_events`はUPDATE/DELETEを明示的に剥奪）を追加
  - `audit_events`のハッシュチェーン直列化を`SELECT ... FOR UPDATE`（UPDATE権限が必要でRLS強制後は使えない）から`pg_advisory_xact_lock`（テーブル権限不要）へ変更（`src/audit/hash-chain.ts`）
  - `test/m0-gate.test.ts`／`test/m1-gate.test.ts`／`test/audit-chain.test.ts`／`test/outbox*.test.ts`を`acquireTenantScopedDb`経由へ統一。`test/helpers/privileged-db.ts`（テスト専用の特権接続）でaudit_eventsの後始末・改ざん模擬に対応
  - `audit:verify`CLI（全テナント横断）は`MIGRATION_DATABASE_URL`を読み取り専用の運用ツールとして使用するよう変更（`src/audit/verify-chain.ts`）
  - CI（`.github/workflows/ci.yml`）を`assen_app`ロール作成＋`DATABASE_URL`/`MIGRATION_DATABASE_URL`分離で実行するよう変更。クリーンなDockerボリュームからの再構築＋全45テストの通過をローカルで実地確認済み
  - **残タスク（M3で対応）**：本番相当環境（Cloud SQL等）でのロール作成・接続確認、および実地の権限侵入テスト（テナント越境ゼロの検証）は未実施
- [x] **バックアップ復旧（復元試験・エンジニアリング部分）**：ローカルDocker Composeの`assen`データベースを対象に、`pg_dump`（カスタム形式）→別DB（`assen_restore_drill`）への`pg_restore`→検証→後片付け、という復元ドリルを整備し実地確認済み：
  - `scripts/db-backup.sh`：`docker compose exec`経由でコンテナ内の`pg_dump`を使用（ホストのクライアントバージョンがサーバー（postgres:16-alpine）と食い違うリスクを回避）
  - `scripts/db-restore-drill.sh`：`assen`本体には触れずに別DBへ復元し、①主要14テーブルの行数一致、②`assen_app`のGRANT（`audit_events`のUPDATE剥奪含む）が復元後も有効か、③`audit_events`のハッシュチェーンが復元後も`audit:verify`で検証を通るか、を確認して最後にドリル用DBを削除する。`scripts/drill-demo-data.ts`（job_order.analyze→confirmを1件実行）で空テーブルによる自明な検証にならないようにしている
  - `scripts/db-restore.sh`：実際の障害対応用（`assen`データベース自体をdrop→recreate→restore。確認プロンプト付き）
  - **実地確認**：上記ドリルの実行に加え、`db-restore.sh`で実際に`assen`をdrop→recreate→restoreし、復元後のDBに対して`audit:verify`と全47件のテストスイート（`assen_app`ロール・RLS強制下）が問題なく通ることを確認済み
  - **残タスク（M3で対応）**：本番相当環境（Cloud SQL）での自動バックアップ/PITRの動作確認、RTO/RPO目標の確定、チームでの復旧訓練（runbook演習）は未実施
- [x] **MCP新旧プロトコル互換（エンジニアリング部分）**：`src/server.ts`から`createAssenHttpServer()`を切り出し、実際にHTTPサーバーを起動して`initialize`をprotocolVersionを変えて送る回帰テスト（`test/protocol-version-compat.test.ts`）を追加。実地確認済みの内容：
  - `@modelcontextprotocol/sdk`（現時点の最新公開版1.29.0）が対応する全5バージョン（最新`2025-11-25`〜最古`2024-10-07`）で`initialize`が正しくネゴシエーションできる
  - 設計書が言及する`2026-07-28` RCは、**執筆時点でSDK 1.29.0自体がまだ対応していない**（`SUPPORTED_PROTOCOL_VERSIONS`に未収録。npm公開版でも1.29.0が最新であることを確認済み）。未対応バージョンを送った場合、サーバーはクラッシュせず、SDKが自身の最新バージョン（`2025-11-25`）へフォールバックした応答を返すことを確認済み（クライアント側が非対応と判断して切断する設計を前提とした、仕様どおりの安全側動作）
  - **残タスク（M3で対応・SDK側のアップデート待ち）**：`2026-07-28` RCへの実対応は、SDKが対応版を公開した後に本テストの期待値を更新して再検証する
- [ ] **golden promptテスト（実LLMでの正答率検証）**：ハーネス自体（フィクスチャ形式・実カタログ取得・正誤判定・カテゴリ別集計、`src/services/golden-prompts/`・`test/golden-prompts/`）は整備済みで、`pnpm run golden-prompts:run`で手動実行できる。直接指示・間接指示・否定形の3系統で計44件のフィクスチャが全14ツール（M1・M2 Phase 1・M2 Phase 2）をカバー。ただし現時点では決定論的なheuristicToolSelector（キーワード一致のスタブ）で配線を検証しているのみで、**「モデルが正しいツール列を選ぶ」という本来の検証は未実施**（実LLM呼び出しへの差し替えはB節のプロバイダ決定待ち。`ToolSelector`型で分離済みのため差し替えは小さな変更で済む見込み）

**Done条件（客観ゲート）**：帳簿との数値照合一致、復旧試験成功、PIIログ検査ゼロ、権限侵入テスト（テナント越境ゼロ）、法的意見書完了。

---

## E. 外販βの客観ゲート（設計書§11「3か月無事故」に追加分） / External-beta objective gate (additional to the "3 months incident-free" bar) / Gate objektif beta eksternal (tambahan pada standar "3 bulan tanpa insiden")

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

## G. 自社利用MVPゲート（外販レジストリ提出とは別軌） / Internal-use MVP gate (separate track from registry submission) / Gate MVP penggunaan internal (jalur terpisah dari pengajuan registry)

**このゲートは上記C・D・E（外販β・レジストリ公開のゲート）とは別軌です。** 外販ゲート通過を待たず、**スグクル社内の限定メンバーがCloud Run上のAssenに接続し、実案件に近いデータで純紹介・派遣の縦切りを承認〜交付まで回せる状態**を先に達成することを目的とします（Phase 0ドッグフーディング、[`法定書類自動化MCP_設計書_v1.md`](../../法定書類自動化MCP_設計書_v1.md) §1「順序」）。

対象は次の2フローに固定します。外販ゲート（上記E）が要求する複数フローの運用実績・法的意見書取得等は本ゲートの対象外です。

1. 純紹介縦切り：`job_order.analyze` → `job_order.confirm` → 労働条件通知書 draft → 承認 → 署名済み添付 → 交付
2. 派遣縦切り：`dispatch_assignment.confirm` → A2/A3/A10 draft → 承認 → 署名済み添付 → 交付

明示的に対象外（外販ゲートまたは将来フェーズへ先送り）：freee `invoice.create_draft`、様式8/11・マージン率集計、T2P期限イベント（4か月/5か月/6か月/closeout）、2026-10-01要領改正の追従実戦、外販β向けDB分離（別インスタンス）、社外レジストリ提出。

- [x] **派遣docType（A2/A3/A10）の承認〜交付E2Eテスト**：`document.generate_draft`→`request_approval`→`approve`→`attach_executed_copy`→`record_delivery`を通し、hash/nonce/期限ガードと職務分離（requester≠approver）が新docTypeでも機能することを確認（`test/m2-dispatch-approval-e2e.test.ts`、3docType×1テスト＋T2P④1件の計4テストが通過）
- [x] **T2P docType最低1件の承認〜交付E2Eテスト**：④求人条件明示書（`job_order_referral`をsubjectとするdocument）で同じ縦切りが機能することを確認（同ファイル）
- [x] **outbox handlerの実装（Slack承認通知）**：`document.approval_requested`にSlack通知handler（`src/services/outbox-worker/handlers/slack-approval-notifier.ts`）を登録した。`SLACK_BOT_TOKEN`/`SLACK_APPROVAL_CHANNEL_ID`未設定時はログ出力のみに留まり例外を投げない（`test/outbox-slack-approval-notifier.test.ts`で確認済み）。**GCS正本保存は元々`generate-draft.ts`/`attach-executed-copy.ts`が`putImmutableObject`経由で同期的に行っており、outbox handlerとしての追加実装は不要と判明した**（正本は既にGCS/MinIOにある）。**freee連携handlerは登録しない**（外販ゲート対象）
- [x] **OAuthトークン交換層の実装**：`src/lib/token-exchange.ts`を新規実装。`POST /oauth/token-exchange`（`src/server.ts`）がGoogle IDトークンを`jose`で検証（issuer/audience/署名）し、`email_verified`確認＋`TOKEN_EXCHANGE_ALLOWLIST_JSON`（email→role/tenantIdマップ）照合の後、Assen専用クレーム（`role`/`tenant_id`/`aud`）付きJWTを自己署名で発行する（下記B節「OAuthプロバイダの確定方式」の(b)案を採用）。署名鍵は`TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK`未設定時は開発用にプロセス起動ごとのエフェメラル鍵を生成（本番は`assertProductionSafety`が設定必須を強制）。公開鍵は`GET /oauth/jwks.json`（`cors.ts`のdiscovery pathsへ追加済み）で配布し、既存の`AUTH_MODE=oauth`検証コード（`src/lib/auth.ts`）がそのまま`OAUTH_JWKS_URI`経由で消費できる。単体テストは`test/token-exchange.test.ts`（有効時：allowlist許可/拒否・email_verified拒否・audience不一致拒否・発行トークンを`verifyOAuthBearerToken`で検証まで通し）と`test/token-exchange-disabled.test.ts`（`GOOGLE_OAUTH_CLIENT_ID`未設定時の無効化動作）に分離（`env.loadEnv`が初回呼び出しでキャッシュされるため）
- [x] **Assen専用Cloud SQLインスタンス・GCSバケット・Cloud Runサービスの構築**：2026-07-24、壁の都度の承認のもとCursorエージェントが実際に構築した。`assen-mvp`（Cloud SQL POSTGRES_16）・`assen-documents-mvp`（GCS）・`assen-runtime`（Cloud Run Service、稼働中: `https://assen-runtime-000000000000.asia-northeast1.run.app`）・`assen-migrator`（Cloud Run Job、実行成功）・`assen-outbox-worker`（Worker Pool、稼働中）・Secret Manager 7個・専用サービスアカウント4個・WIF連携。詳細と当初手順書からの修正点は[`docs/ops-runbook.md`](ops-runbook.md)「実際の構築結果サマリー」参照
- [x] **本番相当環境での`/ready`緑・`tools/list`成功**：`AUTH_MODE=oauth`で実際にGoogle Workspaceブラウザログイン→`/oauth/token-exchange`→Assen JWT→`/mcp`の`initialize`が200で成功することを2026-07-24に確認済み（[`docs/ops-runbook.md`](ops-runbook.md)6.2節追記参照）。Cursor/Claudeからの日常利用手順は[`docs/team-guide.md`](team-guide.md)3.3節、再利用ツールは`scripts/get-assen-token.ts`
- [ ] **本番相当環境でのRLS実効性確認**：別tenantの行が`assen_app`ロールから読めないことをCloud SQL上で確認（ローカルでの確認は上記D節「テナント分離検証」で完了済み。本番環境固有の接続確認が残タスク）
- [~] **社内シャドーラン**：手順書（[`docs/shadow-run-runbook.md`](shadow-run-runbook.md)）を整備し、[`docs/team-guide.md`](team-guide.md)にツール数（15件）・派遣ワークフロー（6.5章）・本番接続状況（3.3章）を反映した。**非開発者による実案件1件の実施自体はこのセッションでは行っていない**（実施後にSlack `#90_dev`への報告を確認してこの項目を`[x]`にする）

**Done条件（客観ゲート）**：上記チェック項目すべて完了し、純紹介・派遣それぞれ1案件が本番相当環境で「取込→確定→draft→承認→署名済み添付→交付」を完走し、`audit:verify`が通ること。

**社労士レビューとの関係**：本ゲート達成は法的レビュー完了を前提としません。ただしレビュー未完了の間は、生成文書・承認UIに「社内検証用ドラフト・対外提出前に人が最終確認」の表示を維持し、実際の対外提出には使わない運用で縛ります（並行して依頼を進める。下記B節参照）。

---

## F. 公開申請の直前に確認する最終チェック / Final check immediately before submission / Pemeriksaan akhir sebelum pengajuan

上記A〜Eがすべて完了して初めて、以下を確認してから申請します。

- [ ] 上記C・D・Eのすべての客観ゲートにチェックが入っている
- [ ] 上記Bの意思決定がすべて確定し、コード（環境変数・`LICENSE`・`SECURITY.md`）に反映されている
- [ ] `docker build --target runtime`が本番相当の環境変数（`AUTH_MODE=oauth`込み）で正常起動する
- [ ] `NODE_ENV=production`で`assertProductionSafety`が要求する全項目（`AUTH_MODE=oauth`・`PII_ENCRYPTION_KEY`・`OAUTH_ISSUER`/`OAUTH_AUDIENCE`/`OAUTH_JWKS_URI`）が本番の実値で設定されている
- [ ] Server Cardの`status.publicListing`の文言を実状に合わせて更新する（現在は「M2/M3ゲート通過後」の待機メッセージ）

---

## 参照 / References / Referensi

- 設計書v1 §11（マイルストーン・客観ゲート）、§2.3（デプロイ・DB配置）、§3.2（法的意見書のスコープ）
- [`README.md`](../README.md) の「本番運用ハードニング」「本番運用への残課題」節
- [`SECURITY.md`](../SECURITY.md)、[`LICENSE`](../LICENSE)
- [`docs/team-guide.md`](team-guide.md)

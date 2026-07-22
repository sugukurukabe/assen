# レジストリ公開レディネスチェックリスト / Registry Publication Readiness Checklist / Checklist Kesiapan Publikasi Registry

## 目的・前提 / Purpose & premise / Tujuan & premis

このドキュメントは「Assenを公式MCPレジストリ（Anthropicコネクタディレクトリ・ChatGPT Appsマーケットプレイス等）へ提出する」ために必要な作業を、
①**すでにコードレベルで整備済み**、②**エンジニアだけでは決められない意思決定**、③**設計書§11のM2/M3客観ゲート（必須・未達成）**の3種類に分けて管理します。

このドキュメントは**登録申請のGoを意味しません**。設計書v1 §11・24行目の方針どおり、**外販β・レジストリ公開申請はM3の客観ゲート通過後**に限ります。現在のマイルストーンはM1完了・M2未着手です。

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
| golden promptハーネス | `src/services/golden-prompts/`（ツールカタログ取得・選択器の型・実行エンジン）と`test/golden-prompts/`（29件のフィクスチャ、CLIエントリポイント`pnpm run golden-prompts:run`）を新規作成。直接指示・間接指示・否定形の3系統でM1の全10ツールをカバー。現時点ではheuristicスタブでの配線検証のみ（実LLMでの正答率検証は未実施、下記D節参照） |
| バックアップ復元ドリル | `scripts/db-backup.sh`／`scripts/db-restore-drill.sh`／`scripts/db-restore.sh`／`scripts/drill-demo-data.ts`を新規作成。ローカルDocker Composeの`assen`データベースで実際に復元ドリルを実行し、行数一致・GRANT維持・audit chain検証・実際の`assen`データベースのdrop→recreate→restore後の全テストスイート通過まで実地確認済み。詳細は下記D節「バックアップ復旧」参照 |
| MCP新旧プロトコル互換テスト | `src/server.ts`から`createAssenHttpServer()`を切り出し、実際にHTTPサーバーを起動して`initialize`のprotocolVersionを変えて送る回帰テスト（`test/protocol-version-compat.test.ts`）を新規作成。SDKが対応する全5バージョンでの成功と、未対応バージョン（`2026-07-28` RC）を送っても安全にフォールバック応答することを実地確認済み。詳細は下記D節参照 |
| **monorepo統合（パス移設）** | 設計書§2.3の決定（下記B節参照）どおり、単独リポジトリだったAssenを`aios`リポジトリの`apps/compliance/`へ実際に移設した。GitHub Actionsのワークフローはリポジトリルートの`.github/workflows/`にしか置けない仕様のため、元の`.github/workflows/ci.yml`は`aios/.github/workflows/compliance-ci.yml`として`paths: ["apps/compliance/**"]`フィルタ＋`working-directory: apps/compliance`付きで再作成し、Dockerビルドは`docker build -f apps/compliance/Dockerfile ... apps/compliance`（コンテキストを`apps/compliance`に限定）へ調整した。データ層（Postgres/audit_events/approval_requests）はAIOSのSupabase/BigQuery/Approved Action Executorとは意図的に統合していない（別進行、下記参照）。移設後、新しい場所で`typecheck`/`lint`/`test`/`build`が実際に通ることを確認済み |

---

## B. 意思決定が必要（エンジニアリングだけでは決められない） / Decisions required (beyond engineering) / Keputusan yang diperlukan (di luar teknik)

これらは壁（Admin）またはビジネス側の判断が必要です。コードは決定後すぐに反映できる形（環境変数・設定ファイル）にしてあります。

| 項目 / Item / Item | 現状 / Current state / Status saat ini | 決定が必要な内容 / What must be decided / Apa yang harus diputuskan |
|---|---|---|
| リポジトリの配置 | **完了**：`aios`リポジトリの`apps/compliance/`へ実際に移設した（上記A節「monorepo統合」参照）。ブランチ`feat/apps-compliance-assen-migration`上での作業で、`aios`の`main`へのマージ・PR起票はまだ行っていない | 統合先ブランチ・PRのマージタイミングは壁の判断（このリポジトリは本番デプロイ中のため） |
| ライセンス方針 | `LICENSE`は「全著作権留保」の暫定既定値 | 公開製品として外販するか、OSSライセンス（例: suguvisa-mcpの前例があればそれに合わせる）を採用するかを決定 |
| セキュリティ報告窓口 | `SECURITY.md`は「Slack `#30-dev`」のプレースホルダ | 外部提出前に実在する監視可能な連絡先（メール/フォーム）へ更新 |
| Server Cardのrepository/contact実値 | `SERVER_CARD_REPOSITORY_URL`/`SERVER_CARD_CONTACT_URL`は未設定（null出力） | 実際のURL確定後に環境変数へ設定 |
| OAuthプロバイダの確定方式 | README・設計書は「本番はGoogle Workspace SSOを想定」と記載 | 標準的なGoogle IDトークンには`role`/`tenant_id`相当のクレームが無いため、(a) Workspace管理者コンソールのカスタム属性をクレームに載せる方式、または(b) Google認証後にAssen専用クレーム付きJWTを発行する薄いトークン交換層を用意する方式、のどちらを採るか決定が必要 |
| 外販時のDB分離 | Phase 0はaios-pg同居を条件付き許容（設計書§2.3） | 外販β開始時は別Cloud SQLインスタンス（可能なら別GCPプロジェクト）へ分離する方針は決定済み。実施タイミングの確定が必要 |
| 法的意見書の依頼 | 未着手 | 高平さん（行政書士）経由で社労士を紹介依頼し、設計書§3.2の9論点（事実選択の主体・条項自動選択の有無・適法判断の不実施・サポート台本・価格設計・広告表現・規程責任・グレー案件引継ぎ・顧客理解可能なUI）について意見書を取得する |

---

## C. M2ゲート：T2P（未着手・公開の前提条件） / M2 gate: T2P (not started; a precondition for publication) / Gate M2: T2P (belum dimulai; prasyarat publikasi)

設計書§11より（〜14週想定）。

- [ ] T2P全書類（⑤⑥⑦⑧⑨⑩）の生成
- [ ] 派遣3点（A2/A3/A10/台帳）の生成
- [ ] 期限イベント（4か月/5か月/6か月/closeout）の実装
- [ ] 採否理由チェーンの実装
- [ ] 手数料③の計算・記録
- [ ] freee連携
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
- [ ] **golden promptテスト（実LLMでの正答率検証）**：ハーネス自体（フィクスチャ形式・実カタログ取得・正誤判定・カテゴリ別集計、`src/services/golden-prompts/`・`test/golden-prompts/`）は整備済みで、`pnpm run golden-prompts:run`で手動実行できる。直接指示・間接指示・否定形の3系統で計29件のフィクスチャがM1の全10ツールをカバー。ただし現時点では決定論的なheuristicToolSelector（キーワード一致のスタブ）で配線を検証しているのみで、**「モデルが正しいツール列を選ぶ」という本来の検証は未実施**（実LLM呼び出しへの差し替えはB節のプロバイダ決定待ち。`ToolSelector`型で分離済みのため差し替えは小さな変更で済む見込み）

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

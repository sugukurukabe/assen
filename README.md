# Assen（法定書類自動化MCP）

職安法・派遣法・労基法の法定帳簿・書類生成を継続的コンプライアンスOSとして提供するMCPサーバー。
MCP server providing a continuous compliance OS for Japanese employment-placement and dispatch-law statutory ledgers and documents.
Server MCP yang menyediakan OS kepatuhan berkelanjutan untuk buku besar dan dokumen wajib hukum ketenagakerjaan dan dispatch Jepang.

本READMEは [`法定書類自動化MCP_設計書_v1.md`](法定書類自動化MCP_設計書_v1.md)（本設計書v1）を正とする実装ガイドです。仕様の詳細・法的根拠・意思決定の経緯は設計書側を参照してください。
This README is the implementation guide with the design doc (`法定書類自動化MCP_設計書_v1.md`) as the source of truth; refer to the design doc for full specifications, legal basis, and decision history.
README ini adalah panduan implementasi dengan dokumen desain (`法定書類自動化MCP_設計書_v1.md`) sebagai sumber kebenaran; lihat dokumen desain untuk spesifikasi lengkap.

**業務担当者向けの使い方ガイドは[`docs/team-guide.md`](docs/team-guide.md)を参照してください**（role別にできること、実践ワークフロー、承認画面の見方、よくあるエラー対処まで実務目線でまとめています）。**Claudeから今すぐ接続したい場合は[`docs/claude-quickstart.md`](docs/claude-quickstart.md)（最短手順のみ）を参照してください。**
**For a practical, role-by-role usage guide (workflows, the approval screen, common errors), see [`docs/team-guide.md`](docs/team-guide.md).**
**Untuk panduan penggunaan praktis per role (workflow, layar persetujuan, error umum), lihat [`docs/team-guide.md`](docs/team-guide.md).**

## スコープ / Scope / Ruang lingkup

- **対象**: 有料職業紹介（許可番号 46-ユ-000000）・労働者派遣（派46-000000）の法定帳簿・書類（求人管理簿、求職管理簿、労働条件通知書、派遣元管理台帳等）
- **非対象**: ビザ・在留書類、e-Gov/ACCORD提出、給与計算・社保、労使協定等の規程系（雛形提供のみ）
- **現在のマイルストーン**: M1完了。M2 Phase 1（基盤整備＋派遣3点書類A2/A3/A10＋A4台帳）・M2 Phase 2（T2P書類④〜⑨＋採否理由チェーン）着手済み。詳細は[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)C節参照
- In scope: statutory ledgers/documents for licensed job placement and worker dispatch. Out of scope: visa/residence documents, e-Gov/ACCORD filing, payroll/social insurance.
- Ruang lingkup: buku besar/dokumen wajib untuk penempatan kerja berlisensi dan dispatch tenaga kerja. Di luar ruang lingkup: dokumen visa/residensi, pengajuan e-Gov/ACCORD, penggajian/asuransi sosial.

## アーキテクチャ / Architecture / Arsitektur

- **Transport**: Streamable HTTP（`/mcp`）。セッションを発行しないstateless構成（§2.4） — 業務状態はすべてPostgresに保持し、リクエストごとに使い捨てのMcpServer/transportを生成する
- **DB**: PostgreSQL 16。Row-Level Securityで`app.tenant_id`によるテナント分離を全クエリに強制する設計（`acquireTenantScopedDb`がリクエストごとにDBコネクションへ設定）。ランタイム接続（`DATABASE_URL`）は非superuser・RLSバイパスなしの`assen_app`ロールを使用し、マイグレーション/GRANT専用の`MIGRATION_DATABASE_URL`（superuser相当、既定ロール`assen`）とは分離済み。テストスイート・CI共に`assen_app`で実行し、RLSが実際に有効であることを確認済み（詳細は[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)のD節参照）
- **Storage**: S3互換オブジェクトストレージ（ローカルはMinIO、本番はGCS）。生成文書はSHA-256をキーにcontent-addressableに保存し、改変を検知可能にする
- **Audit**: 全ての状態変更を`audit_events`にハッシュチェーンで記録（tamper-evident）。`document.approve`は承認対象PDFのハッシュが1バイトでも変われば自動的にvoidする
- **MCP App**: `ui://approval/{approvalRequestId}`リソースがsandboxed iframe向けの承認画面HTMLを返す。書込は必ず`document.approve`ツール経由（UIはトリガーのみで業務データをクライアント側に保持しない）

```
src/
  protocol/            ← MCPアダプタ（capability宣言・server factory・Server Card）
  tools/                ← §7の各ツール（1ファイル1ツール）
  resources/            ← assen:// リソースハンドラ
  apps/approval-ui/     ← MCP App（承認画面）
  services/             ← stateless application services
    extraction/         ← 求人メール等からのヒューリスティック抽出
    rules/               ← 決定論的ルールエンジン（5値判定・LLM非介在）
    documents/           ← 生成・承認・版管理（state machine）
  db/
    schema/              ← Drizzle ORM（§4の全テーブル）
    rls/                 ← RLSポリシー
    migrations/          ← drizzle-kitが生成するSQL
  audit/                 ← ハッシュチェーンappend/検証CLI
legal/
  mapping/                ← 法定項目マトリクス（項目→DB列→出力欄の3点対応表、機械検査つき）
  templates/              ← テキストテンプレート（template_versions管理下）
test/                     ← M0/M1ゲート検証テスト（vitest）
```

## セットアップ / Setup / Pengaturan

前提: Node.js >= 20.9、Docker、pnpm（または npm）

```bash
# 1. 依存関係のインストール
pnpm install

# 2. .envを作成（.env.exampleをコピーして値を埋める。PII_ENCRYPTION_KEYは openssl rand -base64 32 等で生成）
cp .env.example .env

# 3. ローカルPostgres/MinIOを起動
docker compose up -d

# 4. マイグレーション適用（テーブル作成＋RLSポリシー）
node --env-file=.env node_modules/tsx/dist/cli.mjs src/db/migrate.ts

# 5. 開発サーバー起動（http://localhost:8080/mcp）
node --env-file=.env node_modules/tsx/dist/cli.mjs src/server.ts
```

`.env`に秘密情報をコミットしないこと。`.env.example`のみをリポジトリに含める（値は空のまま）。
Never commit secrets in `.env`; only `.env.example` (with empty values) belongs in the repository.
Jangan pernah commit rahasia di `.env`; hanya `.env.example` (dengan nilai kosong) yang boleh masuk repositori.

### Dockerでの実行 / Running with Docker / Menjalankan dengan Docker

```bash
# サーバー本体（既定ターゲット: runtime）
docker build --target runtime -t assen:latest .
docker run --rm -p 8080:8080 --env-file .env assen:latest

# マイグレーション適用専用イメージ（Cloud Run Jobs等での実行を想定）
docker build --target migrator -t assen-migrator:latest .
docker run --rm --env-file .env assen-migrator:latest

# outbox worker（常駐ポーリング。document.approval_requestedのSlack通知handlerを登録済み。他eventTypeの残タスクはsrc/services/outbox-worker/run.ts参照）
docker build --target outbox-worker -t assen-outbox-worker:latest .
docker run --rm --env-file .env assen-outbox-worker:latest
```

`legal/`配下はJSON/テキストのデータファイルでtscの対象外のため、`Dockerfile`は`dist/`と`legal/`を別々にコンテナへコピーします。パス解決は`src/lib/project-root.ts`が祖先ディレクトリを探索して行うため、`src`実行（`tsx`）・`dist`実行（`node`）どちらでも動作します。

## テスト / Testing / Pengujian

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest run（M0/M1ゲート検証を含む）
npm run legal:check-mapping   # legal/mapping/の機械検査（法定項目→DB列→出力欄100%対応）
npm run audit:verify           # audit_eventsのハッシュチェーン検証CLI
```

`test/m0-gate.test.ts`・`test/m1-gate.test.ts`が客観ゲート（§11のDone条件）を自動検証します。

## MCP Tools

| Tool | 用途 | readOnly | 破壊的 |
|---|---|---|---|
| `job_order.analyze` | 求人メール等からヒューリスティック抽出し、fact_assertionsとconfidence/矛盾を返す | no | no |
| `job_order.confirm` | 人間確認済みの値で求人管理簿（帳簿①）を確定する | no | no |
| `compliance.evaluate` | subjectに対する法定ルールを評価し、5値判定（pass/fail/incomplete/ambiguous/expert_review_required）のfindingsを返す | yes | no |
| `document.preview` | 生成前に法定必須項目の充足状況をプレビューする | yes | no |
| `document.generate_draft` | テンプレートから労働条件通知書ドラフトを生成し、content-addressableに保存する | no | no |
| `document.request_approval` | 承認依頼（nonce・artifact hash・期限つき）を作成し、承認UIへのresource_linkを返す | no | no |
| `document.approve` | 承認/差戻しの確定ゲート。hash不一致・期限切れは自動void、ambiguous/expert_review_requiredはブロック | no | yes |
| `document.attach_executed_copy` | 署名済み正本を添付し、execution_statusをexecutedにする | no | no |
| `document.record_delivery` | 交付結果（queued/sent/delivered/failed）を記録する | no | no |
| `document.supersede` | 訂正版を発行し、旧版をsupersededにする | no | no |

## MCP Resources

| Resource | URI | 内容 |
|---|---|---|
| Documents | `assen://documents/{logicalDocumentId}/{version}` | 生成文書のメタデータ・ハッシュ・状態 |
| Findings | `assen://findings/{findingId}` | 5値判定の個別finding |
| Legal rules | `assen://legal-rules/{ruleKey}/{version}` | 決定論的ルールエンジンのルール定義 |
| Audit | `assen://audit/{subjectType}/{subjectId}` | ハッシュチェーン済みaudit_events |
| Approval UI (MCP App) | `ui://approval/{approvalRequestId}` | 承認画面HTML（sandboxed iframe向け、text/html） |

## MCP Prompts

| Prompt | 用途 |
|---|---|
| `intake-job-order` | 求人メール受領〜analyze〜confirmの一連ワークフロー |
| `review-pending-approvals` | 未決の承認依頼を洗い出し、承認画面へ導線を出す |
| `correct-document` | 承認済み文書の訂正版発行（document.supersede）ワークフロー |

## Server Card

`GET /.well-known/mcp.json` がSEP-2127 Draft準拠の静的マニフェストを返します（レジストリ/クローラーがハンドシェイク不要でAssenを発見できるようにするため）。**外販β・レジストリ公開申請は設計書§11のM2/M3客観ゲート通過後**に行う方針で、現時点のServer Cardは技術的な発見可能性の先行実装に留まります。

## セキュリティ・法務上の注意 / Security & legal notes / Catatan keamanan & hukum

- 在留カード・パスポート等の画像はOCR処理後即座に破棄し、サーバーに保存しない
- PIIはアプリケーション層でAES-256-GCM暗号化（`PII_ENCRYPTION_KEY`はローカル開発専用の値。本番はKMSに置き換える）
- 生成される文書はドラフトであり、`document.approve`による人間の承認を経るまで法的に確定しない
- 許可番号（有料職業紹介 46-ユ-000000／労働者派遣 派46-000000）は`tenant_settings`を唯一の参照元とする

## 本番運用ハードニング / Production hardening / Hardening produksi

M1完了後、コードレベルの本番運用ハードニングを実施しました。対応済み項目:

- `document.generate_draft`にtransactional outboxベースの冪等性を実装（同一`idempotencyKey`の再実行で重複draftを作らない）
- 全write tool（`document.generate_draft`／`request_approval`／`attach_executed_copy`／`record_delivery`／`supersede`）に`assertScope`認可チェックを追加（`document.approve`／`job_order.confirm`は元々対応済み）
- HTTPリクエストボディに`MAX_REQUEST_BODY_BYTES`（既定20MB）の上限を追加し、超過時は413を返す。DBコネクション取得より前にチェックすることでpool枯渇を防ぐ
- `executedBytesBase64`にも上限（約15MB相当）を追加
- `PII_ENCRYPTION_KEY`を起動時に32byte(base64)であることを検証。`NODE_ENV=production`では`AUTH_MODE=oauth`必須・`PII_ENCRYPTION_KEY`必須の起動ガードを追加（`assertProductionSafety`）
- DBプール（`pg.Pool`）の`max`／`idleTimeoutMillis`／`connectionTimeoutMillis`を`DB_POOL_*`環境変数で調整可能にした
- `SIGTERM`/`SIGINT`でHTTPサーバーをdrain→DBプールをclose→終了するグレースフルシャットダウンを実装（10秒でタイムアウトし強制終了にフォールバック）。例外発生時もpool clientが必ず解放されるようにtry/finally相当のガードを追加
- `eslint.config.js`（ESLint 9 flat config、`typescript-eslint`使用）を新規作成し、`@typescript-eslint/no-explicit-any: error`を含めて`npm run lint`が通る状態にした
- `GET /ready`を追加（`select 1`で実際のDB接続を確認するreadiness probe。`/health`は静的チェックのまま維持）

Since NODE_ENV / PII_ENCRYPTION_KEY / DB_POOL_* / MAX_REQUEST_BODY_BYTES / AUTH_MODE were touched, see `.env.example` for the full set of newly added variables and their defaults / Karena NODE_ENV / PII_ENCRYPTION_KEY / DB_POOL_* / MAX_REQUEST_BODY_BYTES / AUTH_MODE tersentuh, lihat `.env.example` untuk daftar lengkap variabel baru dan nilai default-nya。

### 公開準備（第2ラウンド） / Publication readiness pass 2 / Kesiapan publikasi (ronde 2)

上記ハードニングの後、公開（レジストリ提出）に向けたコードレベルの下準備を追加しました。判断が必要な項目・M2/M3の客観ゲートは[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)にまとめています。

- **OAuth2 Bearer検証を実装**：`src/lib/auth.ts`に`jose`ベースのJWKS/issuer/audience検証と`role`/`tenant_id`クレームマッピングを実装（`OAUTH_ISSUER`/`OAUTH_AUDIENCE`/`OAUTH_JWKS_URI`/`OAUTH_ROLE_CLAIM`/`OAUTH_TENANT_CLAIM`）。`resolvePrincipal`はasync化。token passthroughは行わない
- **CORSポリシーを実装**：`src/lib/cors.ts`。discoveryエンドポイント（`/health`・`/ready`・`/.well-known/mcp.json`）は全origin許可、`/mcp`は既定で無効、`CORS_ALLOWED_ORIGINS`で明示許可したoriginのみ許可
- **Server Cardを整備**：`repository`/`contact`/`documentation`/`license`欄を追加（未設定時はURLを捏造せずnullを返す。`SERVER_CARD_REPOSITORY_URL`/`SERVER_CARD_CONTACT_URL`で設定）
- **本番向けDockerfileを新規作成**：`runtime`（サーバー本体）／`migrator`（`db:migrate`実行専用）の2ターゲット。ローカルで実際にビルド・起動・マイグレーション適用まで検証済み
- **GitHub Actions CIを新規作成**：`.github/workflows/ci.yml`（lint/typecheck/test/legal:check-mapping/audit:verify/build、Postgres+MinIOを使った統合テスト、Dockerビルド検証）
- **LICENSE・SECURITY.mdを新規作成**：ライセンスは決定までの安全側既定値（全著作権留保）。SECURITY.mdの連絡先はTODOプレースホルダ
- **本番実行パスの不具合を修正**：`npm run build`後に`node dist/server.js`が存在しないパスだった（正しくは`dist/src/server.js`。`package.json`の`start`を修正）ことと、`legal/`配下のJSON/テンプレート読込が固定階層の相対パス（`join(currentDir, "..", "..", "..")`）に依存しdist実行時に破綻することを発見し、`src/lib/project-root.ts`（祖先ディレクトリ探索）へ置き換えて修正。**この不具合により、これまで一度も`node dist/...`での実行やDockerビルドは動作確認されていなかった**

### エンジニアリング下準備（第3ラウンド：outbox worker実行環境） / Engineering groundwork pass 3: outbox worker runtime / Dasar teknik ronde 3: runtime outbox worker

M2依存の意思決定（外部連携handlerの内容）とは独立に進められる範囲で、outbox workerを実際に動かせる状態まで整備しました。

- **cross-tenantなポーリングループを実装**：`transactional_outbox`はRLSで`tenant_id = current_setting('app.tenant_id')`に強制される設計のため、テナント固定なしの接続では本来pending行が見えないはず。`listActiveTenantIds`/`processOutboxBatchForAllTenants`（`src/services/outbox-worker/worker.ts`）がRLSを持たない`tenant_settings`からテナント一覧を取得し、テナントごとに`acquireTenantScopedDb`で接続してから処理する構成に実装（RLSバイパスの特権ロールには依存しない）
- **CLIエントリポイントを新規作成**：`src/services/outbox-worker/run.ts`（`pnpm run outbox:worker`）。`server.ts`と同じ方針でSIGTERM/SIGINTのグレースフルシャットダウンに対応（強制終了タイマーのclearTimeout漏れによる誤"critical"ログもこの過程で見つけて修正）
- **Dockerfileに`outbox-worker`ターゲットを追加**：`legal/`を含まない軽量イメージ。ローカルでビルド・起動・SIGTERM停止まで実機確認済み。CIの`docker-build`ジョブにもビルド確認を追加
- **⚠️重大な発見：ローカル開発ロールがRLSを完全にバイパスしている**：`docker exec`で確認したところ、ローカルDocker Composeの`assen`ロールは`rolsuper=true`かつ`rolbypassrls=true`（superuser）。つまり**これまでのテストスイートは一度もRLSによるテナント分離を実際には検証していない**（RLSポリシー自体は存在するが、superuserには適用されない）。非superuserロールで実際に試したところ、既存テストの多くが`app.tenant_id`を設定せずに書込・読取しており、RLSを本当に強制すると軒並み失敗することを確認（実験後にロール・データは削除済み）。本番でRLSが機能するかは**未検証**であり、テナント分離の実証はM3ゲート「テナント分離検証」として`docs/registry-readiness-checklist.md`に明記
- **テストの汚染防止を修正**：`transactional_outbox`はグローバルなFIFO（`ORDER BY created_at LIMIT batchSize`）でpending行を取得する設計のため、テストが自分の行を削除せずに残すと将来の実行で無関係な行を巻き込む・押し出す不具合があった（本セッション中の繰り返し実行で実際に発生し、テストが不安定になった）。`vitest.config.ts`に`fileParallelism: false`を設定し、`test/outbox*.test.ts`にafterAllでの行削除を追加して解消
- **新規テスト**：`test/outbox-multi-tenant.test.ts`（`listActiveTenantIds`／`processOutboxBatchForAllTenants`のループ範囲を検証。RLSの行レベル分離そのものはローカルでは検証不能なため対象外にしている旨をコメントに明記）

### RLSの実効性検証（第4ラウンド） / RLS effectiveness verification: pass 4 / Verifikasi efektivitas RLS: ronde 4

前ラウンドで発見した「ローカル開発ロールがsuperuserでRLSを完全にバイパスしている」問題を解消し、RLSが実際にテナント分離を強制することを検証しました。

- **migration権限とruntime権限を分離**：`MIGRATION_DATABASE_URL`（superuser相当。テーブル作成・RLS強制・GRANT付与に必要）と`DATABASE_URL`（非superuser・RLSバイパスなしの`assen_app`ロール、アプリ/テストが実際に使う接続）を分離。`src/db/migrate.ts`は前者、`db/client.ts`（アプリ本体）は後者を使う（設計書§2.3）
- **`assen_app`ロールを新規作成**：`docker/initdb/01-create-runtime-role.sql`（ローカルDocker Compose初回起動時に自動作成）、`src/db/rls/002_grant_runtime_role.sql`（`db:migrate`が適用するGRANT。`audit_events`はUPDATE/DELETEを明示的に剥奪し改ざん防止を維持）
- **`audit_events`のハッシュチェーン直列化をアドバイザリロックへ変更**：`SELECT ... FOR UPDATE`による行ロックはPostgresの仕様上UPDATE権限を要求するため、UPDATE/DELETEを持たない`assen_app`では使えなくなった。`pg_advisory_xact_lock(hashtextextended(tenantId, 0))`（テーブル権限に依存しないテナント単位のトランザクションロック）へ置き換え、直列化と改ざん防止を両立（`src/audit/hash-chain.ts`）
- **既存テストを`acquireTenantScopedDb`経由に統一**：`test/m0-gate.test.ts`／`test/m1-gate.test.ts`／`test/audit-chain.test.ts`／`test/outbox*.test.ts`を、本番のリクエストハンドラと同じ`app.tenant_id`固定接続で実行するよう修正。RLS強制下で全45件のテストがクリーンなDockerボリュームからの再構築（`docker compose down -v` → `db:migrate` → `vitest run`）でも通ることを確認済み
- **テスト専用の特権接続ヘルパーを追加**：`test/helpers/privileged-db.ts`（`MIGRATION_DATABASE_URL`を使用）。`audit_events`の後始末（`assen_app`はDELETE不可）と、改ざん検知テストでの「DB直接アクセスによる改ざん」の模擬に使用。アプリのランタイムコードからは使用禁止
- **`audit:verify`CLIを専用の特権接続へ変更**：全テナント横断で検証するツールのためRLSでは原理的に成立せず（`app.tenant_id`未設定時は0行）、`MIGRATION_DATABASE_URL`を読み取り専用で使う運用ツールとして位置付け直した（`src/audit/verify-chain.ts`）
- **CIを`assen_app`ロールで実行するよう変更**：`.github/workflows/ci.yml`にロール作成ステップを追加し、`DATABASE_URL`（`assen_app`）と`MIGRATION_DATABASE_URL`（`assen`＝Actions serviceの既定superuser）を分離。ローカルの動作確認だけでなくCI自体もRLS強制下で検証する
- **副次的に発見・修正**：検証中に`npm run build`後、`dist/test/*.js`がvitestの既定excludeをすり抜けて`test/*.test.ts`と二重実行される問題を発見（テスト数が45→90に倍増して気づいた）。`vitest.config.ts`に`exclude: ["**/node_modules/**", "**/dist/**"]`を明示して解消

### golden promptハーネスの下準備（第5ラウンド） / Golden-prompt harness groundwork: pass 5 / Dasar teknik harness golden-prompt: ronde 5

設計書§12・M3ゲート「golden promptテスト」（直接指示・間接指示・否定形の3系統でモデルのツール選択が正しいかを回帰確認）のうち、実LLMのプロバイダ決定（意思決定事項、下記B節）を待たずに進められるハーネス部分を整備しました。

- **実カタログ取得**：`src/services/golden-prompts/tool-catalog.ts`が`InMemoryTransport`で実物の`McpServer`（`createAssenMcpServer`）へ接続し、本番と同じ`tools/list`レスポンスを取得する（ツール名・descriptionのハードコード二重管理を避ける）
- **ツール選択器をプラガブルに設計**：`ToolSelector`型（`prompt, tools → 選ばれたツール名`）で抽象化。既定実装の`heuristicToolSelector`はツールの実際のtitle/descriptionの語彙をキーワードとして使う決定論的スタブで、否定形（「〜しないで」等）を検出した場合は選択なしを返す。**⚠️これはハーネスの配線を検証するためのものであり、「モデルが正しいツール列を選ぶ」という本来の検証ではない**。実LLMへの差し替えはプロバイダ決定後、`ToolSelector`型を満たす実装に差し替えるだけで済む設計
- **フィクスチャ29件を新規作成**：`test/golden-prompts/fixtures.ts`。M1の全10ツールについて直接指示・間接指示（各10件）・否定形（9件）を用意。`pnpm run golden-prompts:run`で手動実行できるCLI（`test/golden-prompts/run-cli.ts`）も追加
- **配線検証テスト**：`test/golden-prompts.test.ts`が実カタログ取得とheuristicスタブでの全フィクスチャ通過を確認（決定論的でCIに組み込み済み。API keyは不要）

### バックアップ復元ドリル（第6ラウンド） / Backup restore drill: pass 6 / Drill restore backup: ronde 6

設計書§11・M3ゲート「バックアップ復旧（復元試験）」のうち、ローカルで実地確認できる範囲を整備・実行しました。

- **復元ドリルスクリプトを新規作成**：`scripts/db-backup.sh`（コンテナ内`pg_dump`でカスタム形式ダンプ。ホストのクライアントバージョンがサーバーとズレるリスクを回避）、`scripts/db-restore-drill.sh`（`assen`本体には触れず別DB`assen_restore_drill`へ復元→検証→削除）、`scripts/db-restore.sh`（実際の障害対応用。`assen`をdrop→recreate→restore、確認プロンプト付き）、`scripts/drill-demo-data.ts`（job_order.analyze→confirmを1件実行し、空テーブルでの自明な検証を避ける）
- **ドリルが検証する内容**：①主要14テーブルの行数一致、②`assen_app`ロールのGRANT（`audit_events`のUPDATE剥奪含む）が復元後も有効か、③`audit_events`のハッシュチェーンが復元後も`audit:verify`で通るか
- **実地確認**：ドリル（別DBへの復元）に加え、`scripts/db-restore.sh`で実際に`assen`データベース自体をdrop→recreate→restoreし、復元後のDBに対して`audit:verify`と全47件のテストスイート（`assen_app`ロール・RLS強制下）が問題なく通ることを確認済み
- **残課題（M3で対応）**：本番相当環境（Cloud SQL）での自動バックアップ/PITRの動作確認、RTO/RPO目標の確定、チームでの復旧訓練（runbook演習）は未実施

### MCP新旧プロトコル互換テスト（第7ラウンド） / MCP old/new protocol compatibility test: pass 7 / Test kompatibilitas protokol lama/baru MCP: ronde 7

設計書§11・M3ゲート「MCP新旧プロトコル互換（`2025-11-25`安定版／`2026-07-28` RC）」のうち、コードレベルで実地確認できる範囲を整備しました。

- **`src/server.ts`をテスト可能な形にリファクタ**：`createAssenHttpServer(env)`を切り出し（`.listen()`は呼ばない）、テストがエフェメラルポートで実際のHTTPサーバーを起動・破棄できるようにした（`main()`は変更後もこれを呼ぶだけで挙動は同一）
- **新規テスト**：`test/protocol-version-compat.test.ts`。実際に起動したHTTPサーバーへ`initialize`リクエストをprotocolVersionを変えて送信し、①`@modelcontextprotocol/sdk`が対応する全5バージョン（`2025-11-25`最新〜`2024-10-07`最古）でネゴシエーションが成功すること、②`2025-11-25`がSDKの最新サポート対象であること（設計書の「安定版」と一致）、③未対応バージョンでもサーバーがクラッシュしないこと、を確認
- **実地確認した事実**：設計書が言及する`2026-07-28` RCは、**執筆時点でのSDK最新公開版（1.29.0、npm上も最新であることを確認済み）自体がまだ対応していない**（`SUPPORTED_PROTOCOL_VERSIONS`未収録）。このRCの`protocolVersion`を送ると、サーバーはエラーにせず、SDK側が自身の最新バージョン（`2025-11-25`）へフォールバックした応答を返す（クライアントが非対応と判断して切断する、という仕様上の想定どおりの安全側動作）
- **残課題（M3で対応・SDK側のアップデート待ち）**：RCへの実対応そのものは上流SDKのリリース待ち。SDKが対応した時点で本テストの期待値を更新し再検証する

### monorepo統合（第8ラウンド） / Monorepo migration: pass 8 / Migrasi monorepo: ronde 8

設計書§2.3で決定済みの「モノレポ維持（`sugukuru-aios/apps/compliance`）」を実際に実行しました。このディレクトリは現在`aios`リポジトリの`apps/compliance/`です（旧: 単独ディレクトリ`Assen/assen/`）。

- **移設内容**：ソース一式（`src/`・`test/`・`scripts/`・`legal/`・`docs/`・設定ファイル）を`apps/compliance/`へコピー。`node_modules/`・`dist/`・`coverage/`・`backups/`・`.env`は移設せず、新しい場所で再生成/再作成した
- **CIの再配置**：GitHub Actionsの仕様上ワークフローはリポジトリルートの`.github/workflows/`にしか置けないため、元の`.github/workflows/ci.yml`は`aios/.github/workflows/compliance-ci.yml`として再作成した。`paths: ["apps/compliance/**"]`フィルタと`working-directory: apps/compliance`を追加し、`aios`本体のPython向けCI（既存の`ci.yml`）とは完全に独立して動く
- **Dockerビルドパスの調整**：`docker build --target runtime -t ... .`（旧: リポジトリルート直下が前提）から`docker build -f apps/compliance/Dockerfile --target runtime -t ... apps/compliance`（コンテキストを`apps/compliance`に限定）へ変更。Dockerfile自体の内容は無変更（自己完結型のまま）
- **意図的にやっていないこと**：AIOSの既存データ層（Supabase・BigQuery・Approved Action Executor）との統合。Assenは当面、自前のPostgres・`audit_events`ハッシュチェーン・`approval_requests`を持つ独立したサブシステムとして`apps/compliance/`に同居する（データ層統合の方針が決まればM2以降で別途対応）
- **実地確認**：移設後の`apps/compliance/`で`pnpm install`・`typecheck`・`lint`・`test`・`build`が問題なく通ることを確認済み
- **未実施**：`aios`リポジトリへのPR起票・`main`へのマージ。作業はブランチ`feat/apps-compliance-assen-migration`上にあり、マージ判断は壁が行う

### M2 Phase 2：T2P書類④〜⑨＋採否理由チェーン（第9ラウンド） / M2 Phase 2: T2P documents ④-⑨ and the non-hire-reason chain: pass 9 / M2 Phase 2: dokumen T2P ④-⑨ dan rantai alasan tidak diterima: ronde 9

紹介予定派遣（T2P）の書類④〜⑨と、その生成に必須前提となる「採否理由チェーン」（`placement.confirm`）を実装しました。実務フローv1（社外・未レビュー、`~/Downloads/紹介予定派遣_実務フロー_v1.md.docx`）の調査により、④⑤⑦⑧⑨の被評価主体（subject）を新規テーブル`job_order_referrals`とし、⑥はA2と同じ`dispatch_assignments`（`t2pFlag`）を再利用する構成に確定しました。

- **新規テーブル列・enum値**：`job_order_referrals`へ`conditionsTyped`（JSONB、④⑤⑦書類の差込用superset）・`rejectionReason`・`rejectionReasonReceivedAt`列を追加し、`jobSeekerId`を`text`から`uuid` + FK（`job_seekers.id`）へ修正。`party_snapshots.taken_reason` enumへ`job_seeker_accept`を追加
- **新規ドメインschema**：`src/domain/t2p-referral-conditions.ts`（superset）と、④⑤⑥⑦⑧⑨各docType用の個別schema（`t2p-job-order-notice.ts`等）。⑥は既存`dispatch-conditions.ts`の`referralFeeRate`を必須化して再利用し、T2P特有の固定条項（6ヶ月上限・試用期間なし等）はテンプレート側の法定文言として直接記載する方式にした
- **テンプレート・mapping**：④〜⑨の6テンプレート（`legal/templates/t2p-*.v1.txt`）・6mapping（`legal/mapping/t2p-*.json`）を、`~/Downloads`配下の社外・未レビューDOCXから変換して新規作成。法的レビュー未実施（詳細は[`docs/document-catalog.md`](docs/document-catalog.md)参照）
- **生成パイプラインの一般化**：`doc-type-registry.ts`の`subjectType`を`"dispatch_assignment" | "job_order_referral"`のunion型へ拡張。`generate-draft.ts`/`preview.ts`のハードコードされた`dispatchAssignments`直参照を`subject-lookup.ts`（`loadSubjectRow`）経由の分岐に切り替え、入力フィールド`dispatchAssignmentId`を`subjectId`へ一般化（`document.generate_draft`/`document.preview`ツールのinputSchemaも追随）。`subject-values.ts`（新規）が`conditionsTyped`（JSONB）とtyped column（⑨の`rejectionReason`）を描画直前にマージする
- **新規ツール4件**：
  - `job_seeker.confirm`：求職者を確定し帳簿②へposting。氏名・住所・生年月日は`pii-crypto.ts`（既存・M1では未接続だった）でアプリ層暗号化してから保存
  - `job_order_referral.confirm`：確定済みの求人・求職者を紐付け、紹介行（帳簿①②の接点）を作成
  - `placement.confirm`：紹介行の採否（hired/rejected）を確定。hired時は転職勧奨禁止期間（採用日+2年）を自動計算し、party snapshotを作成、帳簿③（`fee_records`）へposting。rejected時は⑧書類生成に必要な項目を記録
  - `placement.record_rejection_reason`：派遣先からの回答受領後、不採用理由をtyped columnへ記録し⑨生成の前提を整える
- **`compliance.evaluate`のjob_order_referral対応**：`SUPPORTED_SUBJECT_TYPES`へ`job_order_referral`を追加し、`subject-lookup.ts`の`loadSubjectRow`にも同分岐を追加（`document.approve`・承認UIが利用する共通ヘルパー）
- **統合テスト**：`test/m2-phase2-t2p-documents.test.ts`にF1〜F6の縦切りシナリオ（`job_order.confirm`→`job_seeker.confirm`→`job_order_referral.confirm`→④⑤生成→`dispatch_assignment.confirm`(t2pFlag)→⑥生成→hiredルート（`placement.confirm`→⑦生成＋`fee_records`検証）／rejectedルート（`placement.confirm`→⑧生成→`placement.record_rejection_reason`→⑨生成））を新規追加。既存の全テストスイート（golden-prompts含む）が通過することを確認済み
- **golden promptハーネスの更新**：新規4ツール分のフィクスチャ（直接・間接・否定形、計12件）とキーワードを追加。フィクスチャ総数29→44件、対象ツール10→14件

⑩「直接雇用切替同意書」はv0ドラフトのみに記載があり、実務フローv1本文に記述がなく対応するテンプレートも見つからなかったため、今回はスコープ外とし[`docs/document-catalog.md`](docs/document-catalog.md)に注記のみ行いました（壁承認済み）。

### OAuthトークン交換層（第10ラウンド） / OAuth token-exchange layer: pass 10 / Layer token-exchange OAuth: ronde 10

自社利用MVPゲート（[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)G節）向けに、B節「OAuthプロバイダの確定方式」の(b)案（トークン交換層）を実装しました。

- **`src/lib/token-exchange.ts`を新規実装**：`exchangeGoogleIdTokenForAssenToken`がGoogle IDトークンを`jose`で検証（issuer/audience/署名。実ネットワークJWKS取得は`getGoogleJwks`だが、テストは`test/oauth-auth.test.ts`と同じ`createLocalJWKSet`注入パターンでオフライン検証）し、`email_verified`確認→`TOKEN_EXCHANGE_ALLOWLIST_JSON`（email→role/tenantIdのJSON配列）照合を経て、Assen専用クレーム（`role`/`tenant_id`/`aud`）付きJWTを自己署名で発行する
- **署名鍵**：`TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK`（JWK文字列）を優先し、未設定時は開発用にプロセス起動ごとのエフェメラルES256鍵を生成（再起動で既発行トークンは失効する。本番では`assertProductionSafety`が`GOOGLE_OAUTH_CLIENT_ID`有効時の設定必須を強制）
- **新規HTTPルート**（`src/server.ts`）：`POST /oauth/token-exchange`（Google IDトークン→Assen JWT）、`GET /oauth/jwks.json`（発行鍵の公開JWKS。既存の`OAUTH_JWKS_URI`検証コード`src/lib/auth.ts`がそのまま消費できる）。`/oauth/jwks.json`は`src/lib/cors.ts`の`DISCOVERY_PATHS`へ追加し全origin許可
- **新規環境変数**：`GOOGLE_OAUTH_CLIENT_ID`（機能有効化フラグ兼Google側audience検証）、`TOKEN_EXCHANGE_ALLOWLIST_JSON`、`TOKEN_EXCHANGE_ISSUER`、`TOKEN_EXCHANGE_TOKEN_TTL_SECONDS`、`TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK`（`.env.example`参照）
- **新規テスト**：`test/token-exchange.test.ts`（有効時：allowlist許可/拒否、`email_verified=false`拒否、audience不一致拒否、発行トークンを既存`verifyOAuthBearerToken`で検証まで通す、allowlistパーサのバリデーション）と`test/token-exchange-disabled.test.ts`（`GOOGLE_OAUTH_CLIENT_ID`未設定時の無効化動作）に分離。`env.loadEnv`が初回呼び出しでキャッシュされるため、有効/無効の切り替えは同一ファイル内では検証できず、ファイル単位のモジュール分離で対応した
- **2026-07-24更新**：本番用署名鍵・issuer確定・Secret Manager投入・allowlist登録（`admin@example.co.jp`のみ）、および実際の`GOOGLE_OAUTH_CLIENT_ID`作成・設定が完了。Google Workspaceブラウザログイン→`/oauth/token-exchange`→Assen JWT→`/mcp`の`initialize`成功までE2Eで確認済み（[`docs/ops-runbook.md`](docs/ops-runbook.md)6.2節追記・[`docs/team-guide.md`](docs/team-guide.md)3.3節参照）。この過程で`assen-runtime`のCloud Run invokerは`allUsers`に開放し、アクセス制御をアプリ層OAuthに一本化した（IAP等のネットワーク層防御は未実施、[`docs/ops-runbook.md`](docs/ops-runbook.md)8節参照）

### 独立リポジトリ化（第11ラウンド） / Extraction to a standalone repository: pass 11 / Ekstraksi ke repositori mandiri: ronde 11

`aios`モノレポ内`apps/compliance/`での開発（第8〜10ラウンド）を経て、`sugukurukabe/assen`として再び独立したpublicリポジトリへ切り出しました。

- **履歴の保持**：`git subtree split --prefix=apps/compliance`で、モノレポ統合以降の3コミット分の履歴を保持したまま抽出した
- **公開に向けたレダクション**：`git filter-repo --replace-text`で、実在のGCPプロジェクトID・プロジェクト番号・Google OAuth Client ID・SlackチャンネルID・許可番号を全履歴からプレースホルダーへ機械的に置換した。WIF自体の安全性はこれらの値の秘匿性に依存しないが、公開リポジトリでの偵察面を減らすための対応。コミット作者名・emailはgit本来の帰属情報のため対象外とした
- **CIワークフローの配置**：旧`aios/.github/workflows/compliance-ci.yml`・`compliance-deploy.yml`は、このリポジトリのルート直下`.github/workflows/ci.yml`・`deploy.yml`として再配置した。`paths`フィルタ・`working-directory: apps/compliance`は不要になったため削除し、Dockerビルドのcontextも`.`（リポジトリルート）に変更した
- **Secretsへの外出し**：`PROJECT_ID`・`WIF_PROVIDER`・`WIF_SERVICE_ACCOUNT`はワークフローYAMLへ直書きせず、GitHub Secretsから読む形に変更した
- **設計書の同梱**：これまで別ディレクトリで管理していた[`法定書類自動化MCP_設計書_v1.md`](法定書類自動化MCP_設計書_v1.md)（設計の正）をこのリポジトリのルートに同梱した
- **`aios`側の後始末**：`aios`リポジトリの`apps/compliance/`・関連ワークフロー（`compliance-ci.yml`/`compliance-deploy.yml`）は削除済み。以後の開発はこのリポジトリのみで行う

### 本番運用への残課題（今回スコープ外） / Remaining production follow-ups (out of scope this round) / Follow-up produksi yang tersisa (di luar cakupan kali ini)

以下は本ハードニング・公開準備の対象外とし、次フェーズに先送りしています（詳細は[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)参照）:
- **outbox workerのeventType handler**：自社MVPゲート（docs/registry-readiness-checklist.md G節）で`document.approval_requested`のSlack通知handler（`src/services/outbox-worker/handlers/slack-approval-notifier.ts`）を登録した。文書バイト本体のGCS/MinIO保存は`generate-draft.ts`/`attach-executed-copy.ts`が既に同期的に行っているためoutbox handlerとしては不要。`document.draft_generated`等の他eventTypeは冪等性チェック目的のみで外部反映不要のため未登録のままdead-letterする（意図した挙動）。**2026-07-24更新**：本番の`SLACK_BOT_TOKEN`/`SLACK_APPROVAL_CHANNEL_ID`を設定済み（既存の`sugukuru_slack_bot_token`を再利用、`#審査完了`へ通知）。`chat.postMessage`の実送信は確認済みだが、実際の承認依頼イベント経由での通知確認は未実施（[`docs/ops-runbook.md`](docs/ops-runbook.md)6.3節参照）。**freee連携（`invoice.create_draft`等）はM2以降**
- **`job_seekers`テーブルのPII暗号化未接続**：`encryptPii`/`decryptPii`（`src/lib/pii-crypto.ts`）は実装済みだが、M1では`job_seekers`に書き込むツールが存在しないため未接続。書込ツール追加時に必ず接続すること
- **OAuthプロバイダの確定方式**：**決定・実装・運用開始・E2E確認まで完了**（上記「OAuthトークン交換層」参照）。トークン交換層（(b)案）を採用し、本番署名鍵/issuer確定・Secret Manager投入・初期allowlist登録・実`GOOGLE_OAUTH_CLIENT_ID`設定・実ログインでのMCP呼び出し成功まで完了。**残るのはネットワーク層の追加防御（IAP/VPN）**（[`docs/ops-runbook.md`](docs/ops-runbook.md)8節参照）
- **golden promptテストの実LLM未接続**：ハーネス（フィクスチャ・実カタログ取得・正誤判定）は整備済みだが、`ToolSelector`の実装はheuristicスタブのみ。実LLMのプロバイダ決定後に差し替えが必要（M3ゲート対象）
- **本番相当環境でのバックアップ/PITR未確認**：復元ドリル自体はローカルDocker Composeで実地確認済みだが、Cloud SQLの自動バックアップ/PITRの動作確認・RTO/RPO目標の確定・チームでの復旧訓練は未実施（M3ゲート対象）
- **MCP `2026-07-28` RCへの実対応は上流SDK待ち**：`@modelcontextprotocol/sdk`の現行最新公開版（1.29.0）自体がまだRCに対応していないため、対応バージョンが公開されたら`test/protocol-version-compat.test.ts`の期待値を更新して再検証する（M3ゲート対象）
- **ライセンス方針・セキュリティ報告窓口の確定**：`LICENSE`/`SECURITY.md`は暫定既定値。外部提出前に実値へ更新すること
- **M2/M3の客観ゲート**：レジストリ公開・外販βの前提条件。[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)のC〜Eを参照
- **M2 Phase 1で対象外にした範囲**：T2P書類④〜⑩の生成、期限イベント（4か月/5か月/6か月/closeout）、採否理由チェーン、手数料③、freee連携、2026-10-01要領改正の追従実戦、A5（派遣先台帳雛形）、A2/A3/A10テンプレートの社労士レビュー。詳細は[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)C節参照
- **M2 Phase 2で対象外にした範囲**：⑩直接雇用切替同意書（テンプレート不在・実務フローv1に記載なし）、期限イベント（4か月/5か月/6か月/closeout）、手数料③の計算ロジック精緻化（`fee_records`へのposting自体は実装済み）、`invoice.create_draft`・freee連携、A5（派遣先台帳雛形）、2026-10-01要領改正の追従実戦、④〜⑨テンプレートの社労士レビュー。詳細は[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)C節参照

## マイルストーン状況 / Milestone status / Status milestone

| 段階 | Done条件（客観ゲート） | 状態 |
|---|---|---|
| M0 基盤 | 全法定項目がDB列・証拠・出力欄へ100%マッピング、匿名化実例で再現可能、監査チェーン検証が通る | 完了（`test/m0-gate.test.ts`） |
| M1 縦切り1本 | 一案件の全操作がactor・時刻・版・ハッシュ付きで追跡可能、approval_requestsのnonce/hash/期限が機能 | 完了（`test/m1-gate.test.ts`、MCP App承認画面実装済み） |
| M2 T2P | T2P全書類、派遣3点、期限イベント、freee連携、2026-10-01要領改正の追従実戦 | Phase 1（基盤整備＋派遣3点書類A2/A3/A10＋A4台帳。`test/m2-dispatch-documents.test.ts`）・Phase 2（T2P書類④〜⑨＋採否理由チェーン。`test/m2-phase2-t2p-documents.test.ts`）着手済み。詳細は[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)C節参照 |

詳細な受け入れ基準・意思決定の経緯は設計書v1の§11を参照してください。

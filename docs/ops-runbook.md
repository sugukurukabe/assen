# Assen 本番相当環境 運用ランブック（自社MVP） / Production-equivalent ops runbook (internal MVP) / Runbook operasional lingkungan setara produksi (MVP internal)

このドキュメントは[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)G節「Assen専用Cloud SQLインスタンス・GCSバケット・Cloud Runサービスの構築」の実行手順です。**2026-07-24、壁の明示的な確認・都度の承認のもとCursorエージェントが実際にすべてのリソースを構築しました**（各コスト発生ステップ・機密値・実ライセンス番号の入力は壁に確認を取ってから実行。以下の各節に実行結果と、手順書の当初想定から実際に必要だった修正を記録する）。

This document is the execution procedure for checklist section G, "Provision Assen's dedicated Cloud SQL instance, GCS bucket, and Cloud Run services." **On 2026-07-24, the Cursor agent actually provisioned every resource below, with 壁's explicit confirmation at each cost-incurring step, secret, and real license-number input.** Each section below records what actually happened and the corrections needed versus the original plan.

Dokumen ini adalah prosedur eksekusi untuk bagian G checklist, "Provisioning instance Cloud SQL, bucket GCS, dan layanan Cloud Run khusus Assen." **Pada 2026-07-24, Cursor agent benar-benar menyediakan setiap resource di bawah ini, dengan konfirmasi eksplisit dari 壁 di setiap langkah berbiaya, secret, dan input nomor lisensi nyata.** Setiap bagian di bawah mencatat apa yang sebenarnya terjadi dan koreksi yang diperlukan dari rencana awal.

## 実際の構築結果サマリー（2026-07-24） / Actual provisioning summary / Ringkasan provisioning aktual

| リソース | 状態 | 詳細 |
|---|---|---|
| Cloud SQL `assen-mvp` | ✅ 作成済み | POSTGRES_16, `db-g1-small`, zonal, PITR有効, IP: 非公開（authorized networksは空に戻した） |
| DB roles `assen`/`assen_app` | ✅ 作成済み | パスワードはhex生成（base64は`/+=`がURLを壊すため不可）、Secret Managerにのみ保存 |
| `assen`データベース・21テーブル・RLS | ✅ `db:migrate`実行済み | `assen-migrator`ジョブ経由でも再実行し冪等性を確認済み |
| `tenant_settings`（スグクル株式会社） | ✅ 1行挿入済み | 有料職業紹介`46-ユ-000000`・労働者派遣`派46-000000`（壁が実番号と確認済み） |
| GCS `assen-documents-mvp` + HMACキー | ✅ 作成済み | |
| Secret Manager（7個） | ✅ 作成済み | `assen-database-url`・`assen-migration-database-url`・`assen-pii-encryption-key`・`assen-token-exchange-signing-key`・`assen-token-exchange-allowlist`（`admin@example.co.jp`, role=admin）・`assen-storage-access-key`・`assen-storage-secret-key` |
| `assen-migrator`（Cloud Run Job) | ✅ 作成・実行成功 | |
| `assen-runtime`（Cloud Run Service） | ✅ デプロイ済み・稼働中 | `https://assen-runtime-000000000000.asia-northeast1.run.app` 。`GOOGLE_OAUTH_CLIENT_ID`は実際の値を設定済み。IAM invokerは`allUsers`に開放（理由は8節参照）。`gcloud run services describe`は`https://assen-runtime-aeqvsod3aq-an.a.run.app`（hash形式）を正規URLとして返すが、project番号形式のURLも同じサービスに解決することを確認済み。`OAUTH_ISSUER`/`OAUTH_JWKS_URI`はproject番号形式で設定した |
| `assen-outbox-worker`（Worker Pool） | ✅ デプロイ済み・稼働中 | |
| Google Sign-In → Assen JWT → MCP `initialize` のE2Eテスト | ✅ 成功（2026-07-24） | 実際のGoogle Workspaceブラウザログイン→`/oauth/token-exchange`→発行されたAssen JWTで`/mcp`の`initialize`が200で成功することを確認済み。手順は[`docs/team-guide.md`](team-guide.md)3.3節、再利用可能なツールは`apps/compliance/scripts/get-assen-token.ts`（`pnpm run auth:get-token`） |
| Slack承認通知連携 | ✅ 設定済み・稼働確認済み（2026-07-24） | 既存の`sugukuru_slack_bot_token`（aiosxagent bot）を再利用し、`#審査完了`（`C00000000`）へ`chat.postMessage`が成功することを確認済み。詳細は6.3節追記参照 |

**未完了・要フォローアップ**：ネットワーク層の追加防御（IAP／VPN）は現時点でドメイン・VPN機器の前提が無いため**意図的に見送り**（アプリ層OAuth＋allowlistを当面の正式方針として採用、8節参照）、GitHub Actions環境保護は未設定（`sugukurukabe`個人アカウントのGitHub Freeプランでは`required reviewers`保護ルール自体が使えないため、有料プランへのアップグレードか代替手段が必要、8節参照）。

## 前提 / Assumptions / Asumsi

- プロジェクト: `REDACTED-GCP-PROJECT`（[`aios/.github/workflows/deploy.yml`](../../../.github/workflows/deploy.yml)と同一。別プロジェクト分離は外販β以降の判断事項、[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)B節参照）
- リージョン: `asia-northeast1`
- 命名: Assen専用リソースは`assen-`prefixで統一し、aios本体のリソースと衝突・混在しないようにする
- 選択したIaC方針: **手運用（gcloud CLI）**。Terraformでの管理も選択肢だったが、aiosの既存Terraform（`infra/terraform`）はaios本体のリソースを対象にしており、Assen専用モジュールを新規に切る作業量に対しMVPで得られる価値が低いと判断し、まずはgcloud CLIで作成し、稼働実績が積めた段階でTerraform化を検討する（この判断は壁が変更可能）

## 0. 事前準備 / Prerequisites / Prasyarat

**実行済み（2026-07-24、壁の指示のもとCursorエージェントが実行）**：必要なAPIはすべて元から有効化されていた（`run` / `sqladmin` / `storage` / `secretmanager` / `artifactregistry` / `iam` / `cloudbuild`）。他のCloud Runサービスと同居するprojectのため`gcloud config set project`でグローバルデフォルトは変更せず、以降すべて`--project=REDACTED-GCP-PROJECT`を明示して実行した。

```bash
gcloud services enable \
  --project=REDACTED-GCP-PROJECT \
  run.googleapis.com \
  sqladmin.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  cloudbuild.googleapis.com
```

## 1. Artifact Registry

**実行済み（2026-07-24）**：

```bash
gcloud artifacts repositories create assen \
  --project=REDACTED-GCP-PROJECT \
  --repository-format=docker \
  --location=asia-northeast1 \
  --description="Assen (compliance MCP) container images"
```

## 2. サービスアカウント / Service accounts / Service account

**実行済み（2026-07-24）**：最小権限のuser-managed service accountを用途ごとに分離する（`cloud-run-basics`スキルのベストプラクティスに従う）。

```bash
# デプロイ用（GitHub Actions WIFが引き受ける） / Deploy identity assumed by GitHub Actions via WIF
gcloud iam service-accounts create assen-deploy \
  --display-name="Assen CI/CD deploy (GitHub Actions WIF)"

# runtime（MCPサーバー本体） / runtime (the MCP server itself)
gcloud iam service-accounts create assen-runtime \
  --display-name="Assen runtime (Cloud Run service)"

# migrator（db:migrate専用。テーブル作成・RLS強制・GRANT付与が必要） / migrator (db:migrate only; needs table/RLS/GRANT privileges)
gcloud iam service-accounts create assen-migrator \
  --display-name="Assen migrator (Cloud Run Job)"

# outbox-worker（常駐poller） / outbox-worker (long-running poller)
gcloud iam service-accounts create assen-outbox-worker \
  --display-name="Assen outbox worker (Cloud Run Worker Pool)"
```

`assen-deploy`にデプロイ権限を付与する（[`cloud-run-basics`](file:///Users/kabe/.claude/skills/cloud-run-basics/references/iam-security.md)の必須ロール）：

```bash
for ROLE in roles/run.admin roles/run.sourceDeveloper roles/iam.serviceAccountUser roles/logging.viewer roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding REDACTED-GCP-PROJECT \
    --member="serviceAccount:assen-deploy@REDACTED-GCP-PROJECT.iam.gserviceaccount.com" \
    --role="$ROLE"
done
```

GitHub ActionsのWorkload Identity Federationプールは`aios`本体のもの（`github-pool`/`github-provider`、プロジェクト番号`000000000000`）を再利用し、`assen-deploy`をそのプールに紐付ける。**実行済み（2026-07-24）**：

```bash
gcloud iam service-accounts add-iam-policy-binding \
  assen-deploy@REDACTED-GCP-PROJECT.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/000000000000/locations/global/workloadIdentityPools/github-pool/attribute.repository/sugukurukabe/aios"
```

## 3. Cloud SQL（専用インスタンス） / Cloud SQL (dedicated instance) / Cloud SQL (instance khusus)

自社MVPではaios本体DBに同居しない専用インスタンスを新規作成する（設計書§2.3・計画書「DBの既定」）。**実行済み（2026-07-24、壁の確認のもとdb-g1-small・zonalで作成）**。プロジェクトの既定Edition設定が`ENTERPRISE_PLUS`だったため、`db-g1-small`等の従来tierを使うには`--edition=ENTERPRISE`を明示する必要があった：

```bash
gcloud sql instances create assen-mvp \
  --project=REDACTED-GCP-PROJECT \
  --database-version=POSTGRES_16 \
  --region=asia-northeast1 \
  --edition=ENTERPRISE \
  --tier=db-g1-small \
  --storage-size=20 \
  --storage-auto-increase \
  --enable-point-in-time-recovery \
  --backup-start-time=18:00 \
  --availability-type=zonal

gcloud sql databases create assen --project=REDACTED-GCP-PROJECT --instance=assen-mvp

# superuser相当のmigrationロール（既存ローカル運用のパスワードはSecret Managerで管理する値に置き換える）
gcloud sql users create assen --project=REDACTED-GCP-PROJECT --instance=assen-mvp --password="<Secret Managerで生成した値>"
```

`assen_app`（RLSバイパスなしのruntimeロール）と権限付与（`GRANT`）は、ローカル/CIと同じ仕組みで**アプリの`db:migrate`自身が行う**（[`src/db/migrate.ts`](../src/db/migrate.ts)・[`src/db/rls/002_grant_runtime_role.sql`](../src/db/rls/002_grant_runtime_role.sql)参照）。手動でのSQL実行は不要。ただし`assen_app`ロール自体を先に作成しておく必要がある（ローカルの[`docker/initdb/01-create-runtime-role.sql`](../docker/initdb/01-create-runtime-role.sql)と同じ内容をCloud SQL上で一度だけ実行）：

```bash
gcloud sql users create assen_app --project=REDACTED-GCP-PROJECT --instance=assen-mvp --password="<Secret Managerで生成した値>"
```

**実行済み（2026-07-24）**。実際に確認できた点：

- パスワードは`openssl rand -base64 24`ではなく**`openssl rand -hex 24`で生成すること**。base64は`/`・`+`・`=`を含むことがあり、これをそのまま`postgres://user:PASSWORD@host/db`形式のURLに埋め込むとURLパースが壊れる（percent-encodeするか、最初からURLセーフな文字集合で生成するかの二択で、後者を採用した）
- `gcloud sql users create`で作成したロールは、Cloud SQL Postgresの既定動作として`CREATEROLE`・`CREATEDB`権限とデータベースへの`CREATE`権限を自動的に持つ（`ALTER DATABASE ... OWNER TO`や`GRANT cloudsqlsuperuser`は不要だった。実際に`CREATE TABLE`が素の`assen`ロールで成功することを確認済み）
- Cloud SQL Auth Proxy（`cloud-sql-proxy`バイナリ）はこの開発環境のGoogle認証セッションで`invalid_rapt`（reauth必須）エラーが出て使えなかった。代わりに一時的に`gcloud sql instances patch --authorized-networks=<自分のIP>/32`で自分のIPを許可し、直接TCP+TLSで接続した。**作業後は必ず`--clear-authorized-networks`で戻すこと**（本番のCloud RunアクセスはUnixソケット経由の`--add-cloudsql-instances`のみを使い、恒常的なpublic IP許可は行わない）
- 直接TCP接続時、`node-postgres`（`pg`）は`sslmode=require`を`verify-full`相当として扱うため証明書検証で失敗する。接続文字列に`&uselibpqcompat=true`を追加して暗号化のみ・検証なしの動作にする必要があった（**この対処はCloud Run本番の接続では不要**。Cloud RunはUnixソケット経由でCloud SQL Auth Proxyが自動的に付与されるため、SSL/TLSのネゴシエーション自体が発生しない）

Cloud RunからのIP接続はCloud SQL Auth Proxy（`--add-cloudsql-instances`）を使う。`assen-runtime`・`assen-migrator`・`assen-outbox-worker`の各サービスアカウントに`roles/cloudsql.client`を付与する（**実行済み・2026-07-24**）：

```bash
for SA in assen-runtime assen-migrator assen-outbox-worker; do
  gcloud projects add-iam-policy-binding REDACTED-GCP-PROJECT \
    --member="serviceAccount:${SA}@REDACTED-GCP-PROJECT.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"
done
```

## 4. GCS（文書バイトの正本保存） / GCS (canonical document byte storage) / GCS (penyimpanan byte dokumen kanonik)

**実行済み（2026-07-24）**：

```bash
gcloud storage buckets create gs://assen-documents-mvp \
  --project=REDACTED-GCP-PROJECT \
  --location=asia-northeast1 \
  --uniform-bucket-level-access \
  --public-access-prevention
```

`src/lib/storage.ts`はS3互換クライアント（`@aws-sdk/client-s3`）のみを実装しており、GCSネイティブAPIには対応していない。**コード変更ではなく設定のみで対応する**：GCSのS3互換XML APIエンドポイント（`https://storage.googleapis.com`）とHMACキーを使う。

```bash
gcloud storage hmac create assen-runtime@REDACTED-GCP-PROJECT.iam.gserviceaccount.com --project=REDACTED-GCP-PROJECT
# 出力されたaccessId/secretをSecret Managerへ格納する（下記5節）。secretはこの1回しか表示されないため、
# JSON出力をファイルにリダイレクトしてからSecret Managerへ流し込み、ファイルを削除するとターミナル履歴に残らない

gcloud storage buckets add-iam-policy-binding gs://assen-documents-mvp \
  --project=REDACTED-GCP-PROJECT \
  --member="serviceAccount:assen-runtime@REDACTED-GCP-PROJECT.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
# outbox-workerもGCSへの正本保存を行うため同様に付与する
gcloud storage buckets add-iam-policy-binding gs://assen-documents-mvp \
  --project=REDACTED-GCP-PROJECT \
  --member="serviceAccount:assen-outbox-worker@REDACTED-GCP-PROJECT.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

`STORAGE_ENDPOINT=https://storage.googleapis.com` / `STORAGE_BUCKET=assen-documents-mvp` / `STORAGE_ACCESS_KEY`・`STORAGE_SECRET_KEY`はHMACキーの値を使う。

## 5. Secret Manager

**実行済み（2026-07-24）**。当初想定との差分：

- このGCP組織には`constraints/gcp.resourceLocations`ポリシーがあり、`--replication-policy`未指定（`global`扱い）ではSecret作成が`FAILED_PRECONDITION`で拒否される。**`--replication-policy=user-managed --locations=asia-northeast1`を明示すること**
- `TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK`生成時、`require("jose")`のCJS呼び出しでは`generateKeyPair`の鍵が`extractable: false`になり`exportJWK`が失敗する。`src/lib/token-exchange.ts`の実装と同じく`generateKeyPair("ES256", { extractable: true })`を明示すること
- パスワード・secretの値は一度も画面に印字せず、シェル変数からパイプで直接`gcloud secrets create --data-file=-`へ渡す運用を徹底した

```bash
# DATABASE_URL（assen_appロール、Cloud SQL Auth Proxy経由のUnixソケット形式。Cloud Run本番はこの形式）
CONN=REDACTED-GCP-PROJECT:asia-northeast1:assen-mvp
printf 'postgres://assen_app:%s@localhost/assen?host=/cloudsql/%s' "$ASSEN_APP_DB_PASSWORD" "$CONN" | \
  gcloud secrets create assen-database-url --project=REDACTED-GCP-PROJECT --replication-policy=user-managed --locations=asia-northeast1 --data-file=-

# MIGRATION_DATABASE_URL（superuser相当のassenロール）
printf 'postgres://assen:%s@localhost/assen?host=/cloudsql/%s' "$ASSEN_DB_PASSWORD" "$CONN" | \
  gcloud secrets create assen-migration-database-url --project=REDACTED-GCP-PROJECT --replication-policy=user-managed --locations=asia-northeast1 --data-file=-

# PII_ENCRYPTION_KEY（32byte base64。これは接続URLに埋め込まないので通常のbase64で問題ない）
openssl rand -base64 32 | tr -d '\n' | \
  gcloud secrets create assen-pii-encryption-key --project=REDACTED-GCP-PROJECT --replication-policy=user-managed --locations=asia-northeast1 --data-file=-

# TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK（ES256 private JWK。extractable: trueが必須）
node -e "
import('jose').then(async ({ generateKeyPair, exportJWK }) => {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.alg = 'ES256';
  process.stdout.write(JSON.stringify(jwk));
});
" | gcloud secrets create assen-token-exchange-signing-key --project=REDACTED-GCP-PROJECT --replication-policy=user-managed --locations=asia-northeast1 --data-file=-

# GCS HMACキー（4節で発行した値。JSON出力から直接抽出し画面には出さない）
python3 -c "import json; print(json.load(open('/tmp/assen-hmac.json'))['metadata']['accessId'], end='')" | \
  gcloud secrets create assen-storage-access-key --project=REDACTED-GCP-PROJECT --replication-policy=user-managed --locations=asia-northeast1 --data-file=-
python3 -c "import json; print(json.load(open('/tmp/assen-hmac.json'))['secret'], end='')" | \
  gcloud secrets create assen-storage-secret-key --project=REDACTED-GCP-PROJECT --replication-policy=user-managed --locations=asia-northeast1 --data-file=-

# TOKEN_EXCHANGE_ALLOWLIST_JSON（初期allowlist。tenant_idはtenant_settingsに登録する値と一致させる。
# 自社MVPでは admin@example.co.jp / role=admin で開始した）
printf '[{"email":"admin@example.co.jp","role":"admin","tenantId":"<tenant_settingsのtenant_id>"}]' | \
  gcloud secrets create assen-token-exchange-allowlist --project=REDACTED-GCP-PROJECT --replication-policy=user-managed --locations=asia-northeast1 --data-file=-

# SLACK_BOT_TOKEN/SLACK_APPROVAL_CHANNEL_ID: 未作成（Slackアプリを作成後に追加する。未設定の間はoutbox handlerがログ出力のみに留まる。8節参照）
```

各Secretに、参照する側のサービスアカウントへ`roles/secretmanager.secretAccessor`を付与する（実行済み。`assen-migrator`もSTORAGE_*環境変数のenv検証が必須なため、STORAGE系2つも追加で付与した点が当初想定との差分）：

```bash
# assen-runtime: 全7 secretへアクセス
for SECRET in assen-database-url assen-pii-encryption-key \
  assen-token-exchange-signing-key assen-token-exchange-allowlist \
  assen-storage-access-key assen-storage-secret-key; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project=REDACTED-GCP-PROJECT \
    --member="serviceAccount:assen-runtime@REDACTED-GCP-PROJECT.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# assen-migrator: DB系2つ＋STORAGE系2つ（env.ts検証のため。実際にSTORAGE値を使うわけではない）
for SECRET in assen-database-url assen-migration-database-url assen-storage-access-key assen-storage-secret-key; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project=REDACTED-GCP-PROJECT \
    --member="serviceAccount:assen-migrator@REDACTED-GCP-PROJECT.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# assen-outbox-worker: DB＋Storage（Slackは未設定）
for SECRET in assen-database-url assen-storage-access-key assen-storage-secret-key; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project=REDACTED-GCP-PROJECT \
    --member="serviceAccount:assen-outbox-worker@REDACTED-GCP-PROJECT.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

## 6. Cloud Run（初回作成。以降は[`compliance-deploy.yml`](../../../.github/workflows/compliance-deploy.yml)がrevision更新する） / Cloud Run (initial creation; subsequent revisions are updated by compliance-deploy.yml) / Cloud Run (pembuatan awal; revisi selanjutnya diperbarui oleh compliance-deploy.yml)

**実行済み（2026-07-24）**。当初想定との差分：

- macOS（Apple Silicon）でのローカル`docker build`は既定でarm64イメージを作る。Cloud Runは`linux/amd64`必須のため、**`docker build --platform linux/amd64 ...`を必ず指定すること**（未指定でpushすると`gcloud run jobs create`/`gcloud run deploy`が「must support amd64/linux」エラーで失敗する）
- `gcloud run jobs create`には`--add-cloudsql-instances`ではなく**`--set-cloudsql-instances`**を使う（`gcloud run deploy`/`services update`は`--add-cloudsql-instances`で正しい。サブコマンドによってフラグ名が異なる）
- `migrate.ts`はDB以外の環境変数（`STORAGE_*`）もenv検証で要求するため、migratorジョブにも`STORAGE_ENDPOINT`/`STORAGE_BUCKET`/`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`を渡す必要がある（実際には使わないが、`loadEnv()`のzodスキーマ検証で落ちる）
- `OAUTH_JWKS_URI`は初回デプロイ前から**予測可能**：Cloud Run（第2世代）のURLは`https://<service>-<project番号>.<region>.run.app`の形式で決まるため（このprojectでは`000000000000`）、`https://assen-runtime-000000000000.asia-northeast1.run.app`を最初から`OAUTH_ISSUER`/`OAUTH_JWKS_URI`/`TOKEN_EXCHANGE_ISSUER`に設定して1回のデプロイで済ませた（`assertProductionSafety`がこれらを起動時に必須にしており、後から追記する二段階デプロイを避けられる）
- `gcloud run worker-pools deploy`はこのマシンのgcloud Python環境に`grpc`/`cffi`が無く`ModuleNotFoundError`で失敗した。システムのPython（Homebrew管理）を汚さないよう、`python3 -m venv`で専用venvを作り`pip install grpcio cffi`した上で`CLOUDSDK_PYTHON=<venv>/bin/python`を指定して実行した

```bash
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
cd apps/compliance
for TARGET in runtime migrator outbox-worker; do
  docker build --platform linux/amd64 -f Dockerfile --target ${TARGET} \
    -t asia-northeast1-docker.pkg.dev/REDACTED-GCP-PROJECT/assen/${TARGET}:bootstrap .
  docker push asia-northeast1-docker.pkg.dev/REDACTED-GCP-PROJECT/assen/${TARGET}:bootstrap
done
```

### 6.1 migrator（Cloud Run Job）

```bash
gcloud run jobs create assen-migrator \
  --project=REDACTED-GCP-PROJECT \
  --image=asia-northeast1-docker.pkg.dev/REDACTED-GCP-PROJECT/assen/migrator:bootstrap \
  --region=asia-northeast1 \
  --service-account=assen-migrator@REDACTED-GCP-PROJECT.iam.gserviceaccount.com \
  --set-cloudsql-instances=REDACTED-GCP-PROJECT:asia-northeast1:assen-mvp \
  --set-env-vars=STORAGE_ENDPOINT=https://storage.googleapis.com,STORAGE_BUCKET=assen-documents-mvp \
  --set-secrets=DATABASE_URL=assen-database-url:latest,MIGRATION_DATABASE_URL=assen-migration-database-url:latest,STORAGE_ACCESS_KEY=assen-storage-access-key:latest,STORAGE_SECRET_KEY=assen-storage-secret-key:latest \
  --max-retries=0 \
  --task-timeout=300

gcloud run jobs execute assen-migrator --project=REDACTED-GCP-PROJECT --region=asia-northeast1 --wait
```

**実行結果**：`Execution [assen-migrator-vsps2] has successfully completed.`（drizzleマイグレーションは冪等のため、ローカルで一度手動実行した後にジョブ経由で再実行しても正常終了することを確認済み。これはCloud Run→Cloud SQL Unixソケット接続の疎通確認としても機能した）

### 6.2 runtime（Cloud Run Service）

`AUTH_MODE=oauth`はアプリ層のBearer検証（[`docs/team-guide.md`](team-guide.md)経由のトークン交換フロー）。IAPはネットワーク層の追加防御で、計画書「社内のみ: IAPまたは組織VPN + OAuth必須」に対応する（[`cloud-run-basics`のIAM/securityリファレンス](file:///Users/kabe/.claude/skills/cloud-run-basics/references/iam-security.md)の`--iap`フラグを使用）。**2026-07-24時点ではIAPは未設定**（IAP OAuth brandのプロジェクト全体設定が必要で、壁の確認を別途要するため8節のフォローアップとした）。`--no-allow-unauthenticated`によるCloud Run IAM認証（`roles/run.invoker`）とアプリ層のOAuth Bearer検証の2層で当面は運用する：

```bash
RUNTIME_URL="https://assen-runtime-000000000000.asia-northeast1.run.app"
gcloud run deploy assen-runtime \
  --project=REDACTED-GCP-PROJECT \
  --image=asia-northeast1-docker.pkg.dev/REDACTED-GCP-PROJECT/assen/runtime:bootstrap \
  --region=asia-northeast1 \
  --service-account=assen-runtime@REDACTED-GCP-PROJECT.iam.gserviceaccount.com \
  --add-cloudsql-instances=REDACTED-GCP-PROJECT:asia-northeast1:assen-mvp \
  --no-allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,AUTH_MODE=oauth,OAUTH_ISSUER=${RUNTIME_URL}/token-exchange,OAUTH_AUDIENCE=assen,OAUTH_JWKS_URI=${RUNTIME_URL}/oauth/jwks.json,OAUTH_ROLE_CLAIM=role,OAUTH_TENANT_CLAIM=tenant_id,STORAGE_ENDPOINT=https://storage.googleapis.com,STORAGE_BUCKET=assen-documents-mvp,GOOGLE_OAUTH_CLIENT_ID=placeholder-not-yet-configured,TOKEN_EXCHANGE_ISSUER=${RUNTIME_URL}/token-exchange" \
  --set-secrets=DATABASE_URL=assen-database-url:latest,PII_ENCRYPTION_KEY=assen-pii-encryption-key:latest,TOKEN_EXCHANGE_SIGNING_PRIVATE_KEY_JWK=assen-token-exchange-signing-key:latest,TOKEN_EXCHANGE_ALLOWLIST_JSON=assen-token-exchange-allowlist:latest,STORAGE_ACCESS_KEY=assen-storage-access-key:latest,STORAGE_SECRET_KEY=assen-storage-secret-key:latest
```

**実行結果**：`Service URL: https://assen-runtime-000000000000.asia-northeast1.run.app`。`curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" .../.well-known/mcp.json`で200が返り、`legalDomain.licenses`に実際の許可番号が表示されることを確認済み。

**2026-07-24 追記（`GOOGLE_OAUTH_CLIENT_ID`の実値設定と公開ingress化）**：

1. Google Cloud Console（`https://console.cloud.google.com/apis/credentials?project=REDACTED-GCP-PROJECT`）で壁がOAuth consent screen（User Type: Internal）とOAuth 2.0クライアントID（種類: Webアプリケーション、Authorized redirect URI: `http://localhost:8945/callback`）を手動作成した。**この操作にgcloud CLI相当のコマンドは存在しない**（`gcloud iap oauth-brands`/`oauth-clients`は2026年3月に完全廃止された旧API であり、かつ元々IAP専用でGeneral目的のOAuthクライアント作成には使えない）。取得したClient IDを実値として反映：
   ```bash
   gcloud run services update assen-runtime \
     --project=REDACTED-GCP-PROJECT --region=asia-northeast1 \
     --update-env-vars=GOOGLE_OAUTH_CLIENT_ID=<実際のClient ID>
   ```
2. 実際にGoogle Workspaceでブラウザログイン→`/oauth/token-exchange`を呼んだところ、**`--no-allow-unauthenticated`のままではCloud Run/Google Frontend自体が401 "Your client does not have permission"を返し、アプリに到達する前にブロックされることが判明**した。`/oauth/token-exchange`はまさに「まだAssen JWTを持っていない人向けの入口」であり、Cloud Run側のIAM認証と構造的に矛盾するため、`roles/run.invoker`を`allUsers`に付与してネットワーク層を公開に変更した（壁に確認済み）：
   ```bash
   gcloud run services add-iam-policy-binding assen-runtime \
     --project=REDACTED-GCP-PROJECT --region=asia-northeast1 \
     --member="allUsers" --role="roles/run.invoker"
   ```
   これにより実質的なアクセス制御は完全にアプリ層（`AUTH_MODE=oauth`のBearer JWT検証＋`TOKEN_EXCHANGE_ALLOWLIST_JSON`）に一本化された。ネットワーク層の追加防御（IAP／VPN）は8節の残タスク。
3. E2E動作確認（`apps/compliance/scripts/get-assen-token.ts`で実施）：実際のGoogle Workspaceログイン→Google ID Token取得→`/oauth/token-exchange`でAssen JWT取得→`/mcp`への`initialize`呼び出しが200で成功。この際、`/mcp`は`Accept: application/json, text/event-stream`ヘッダが無いと406を返す仕様（MCP Streamable HTTPの標準仕様どおり、Cloud Run固有の問題ではない）ことも確認した。

### 6.3 outbox-worker（Cloud Run Worker Pool）

`src/services/outbox-worker/run.ts`はHTTPポートを開かない常駐pollerのため、Cloud Run Servicesではなく**Worker Pools**（`gcloud run worker-pools deploy`）を使う（[`cloud-run-basics`スキル](file:///Users/kabe/.claude/skills/cloud-run-basics/SKILL.md)の分類に従う。ServicesはHTTPリクエスト応答用、Worker PoolsはPub/Sub pull等と同種の常駐pull型処理用）。SLACK関連は未設定のため`--set-secrets`から除外している（設定後は`gcloud run worker-pools deploy`を再実行して追加すること）：

```bash
# grpc/cffiが必要（このマシンでは専用venvを用意した。6節冒頭の差分参照）
python3 -m venv /tmp/gcloud-grpc-venv
/tmp/gcloud-grpc-venv/bin/pip install grpcio cffi
export CLOUDSDK_PYTHON=/tmp/gcloud-grpc-venv/bin/python

gcloud run worker-pools deploy assen-outbox-worker \
  --project=REDACTED-GCP-PROJECT \
  --image=asia-northeast1-docker.pkg.dev/REDACTED-GCP-PROJECT/assen/outbox-worker:bootstrap \
  --region=asia-northeast1 \
  --service-account=assen-outbox-worker@REDACTED-GCP-PROJECT.iam.gserviceaccount.com \
  --add-cloudsql-instances=REDACTED-GCP-PROJECT:asia-northeast1:assen-mvp \
  --set-env-vars=NODE_ENV=production,STORAGE_ENDPOINT=https://storage.googleapis.com,STORAGE_BUCKET=assen-documents-mvp \
  --set-secrets=DATABASE_URL=assen-database-url:latest,STORAGE_ACCESS_KEY=assen-storage-access-key:latest,STORAGE_SECRET_KEY=assen-storage-secret-key:latest \
  --instances=1
```

**実行結果**：`Worker pool [assen-outbox-worker] revision [assen-outbox-worker-00001-9wz] has been deployed.` ログに`outbox workerを起動しました`・`STARTUP START_COMPLETE probe succeeded`を確認済み（worker poolのログは`resource.labels.revision_name`で検索する。`resource.type="cloud_run_revision"`では出てこない。実際の`resource.type`は`cloud_run_worker_pool`）。

**2026-07-24 追記（Slack承認通知の設定）**：

1. GCPには既に他システム用のSlack Bot Tokenが複数存在していた（`my-mcp-slack-bot-token`・`slack-bot-token`・`sugukuru-mcp-slack-bot-token`・`sugukuru-os-v4-slack-bot-token`・`sugukuru_slack_bot_token`）。壁の判断で新規Slack App作成は行わず、**`sugukuru_slack_bot_token`（スグクル株式会社ワークスペース、bot: `aiosxagent`）を再利用**することにした
2. `assen-outbox-worker`のサービスアカウントにこのSecretへの読み取り権限を追加：
   ```bash
   gcloud secrets add-iam-policy-binding sugukuru_slack_bot_token \
     --project=REDACTED-GCP-PROJECT \
     --member="serviceAccount:assen-outbox-worker@REDACTED-GCP-PROJECT.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```
3. 送信先チャンネルはSlack Web API（`conversations.list`）でbotが参加済みのチャンネル一覧を実際に取得し、壁が`#審査完了`（`C00000000`）を選定した
4. `assen-outbox-worker`を`SLACK_BOT_TOKEN=sugukuru_slack_bot_token:latest`（secret）・`SLACK_APPROVAL_CHANNEL_ID=C00000000`（env var）付きで再デプロイ（`gcloud run worker-pools deploy`を同じイメージ・設定で再実行。**worker poolsには`update`サブコマンドが存在するように見えるが、grpc依存の読み込みに失敗するため実質使えない。既存poolへの変更は`deploy`の再実行で行う**）
5. Worker再起動後のログで`outbox workerを起動しました`を確認し、クラッシュがないことを確認
6. `chat.postMessage`を直接呼び、`#審査完了`への投稿が`ok:true`で成功することを実際に確認（確認用メッセージは`chat.delete`で削除済み）

これにより、実際の承認依頼発生時（`document.approval_requested`イベント）にSlackへ通知が届くようになった。

## 7. GitHub Actions側の設定 / GitHub Actions setup / Setelan sisi GitHub Actions

[`.github/workflows/compliance-deploy.yml`](../../../.github/workflows/compliance-deploy.yml)は`environment: assen-internal`を`migrate`/`deploy-runtime`/`deploy-outbox-worker`ジョブに指定している。GitHub repo設定（Settings → Environments → New environment → `assen-internal`）でrequired reviewers（壁を含む）を設定することで、デプロイ前に人の承認を必須化する。未設定のままだとゲートなしでデプロイが進むため、**運用開始前に必ず設定すること（未実施）**。

## 8. 残タスク（2026-07-24時点） / Remaining follow-ups / Tugas lanjutan

自社MVPの基盤は稼働しており、Google Workspaceログイン→Assen JWT→MCPツール呼び出しのE2Eも成功済み。以下は今回のセッションでは完了していない：

1. ~~`GOOGLE_OAUTH_CLIENT_ID`が未設定~~ → **完了（2026-07-24）**。6.2節追記を参照
2. **ネットワーク層の追加防御（IAP／VPN）は意図的に見送り（2026-07-24、壁の判断）**：現在`assen-runtime`のCloud Run invokerは`allUsers`に開放し、アクセス制御をアプリ層OAuth（`AUTH_MODE=oauth`のBearer JWT検証＋`TOKEN_EXCHANGE_ALLOWLIST_JSON`）のみに一本化している（6.2節追記参照）。検討した結果は次のとおり：
   - **IAP**：旧Admin API（`gcloud iap oauth-brands`/`oauth-clients`）は2026年3月19日に完全廃止済みのため、今後追加する場合は**External HTTPS Load Balancer＋Cloud Run NEGバックエンド＋新IAP構成**が必要。これには**ドメイン名（Google管理SSL証明書用）とDNS制御権**、および静的IP予約（継続コスト）が前提となる。**現時点で使えるドメインが無いため見送り**
   - **VPN**：オフィス側にVPN接続用の機器（ルーター等）やCloud VPNを組む前提が無いため、**現時点では非現実的と判断し見送り**
   - 自社MVPの利用規模（allowlistで管理された少人数の社内メンバーのみ）を踏まえ、**アプリ層OAuth＋allowlistを当面の正式なアクセス制御方針として採用**する。ドメイン確保やVPN機器導入の目処が立った時点で本項目を再評価する（hardening backlog）
3. ~~Slack連携が未設定~~ → **完了（2026-07-24）**。既存の`sugukuru_slack_bot_token`を再利用し`#審査完了`へ通知する構成で稼働確認済み。6.3節追記を参照
4. **GitHub Actions環境保護（7節）が未設定**：`gh api`で実際に試したところ、`sugukurukabe`個人アカウント＋private repoの組み合わせではGitHub Freeプランで`required reviewers`保護ルールが使えないことが判明（422エラー：「Please ensure the billing plan supports the required reviewers protection rule」）。対応案は(a) GitHub Proへアップグレード（月$4、Web UIでの手動操作が必要）、(b) デプロイworkflowを`workflow_dispatch`（手動トリガーのみ）に変更してpush自動デプロイを無効化する、のいずれか。壁の判断待ち
5. **IPアドレス許可の運用**：本ランブックの3節・4節では一時的に自分のIPをCloud SQLのauthorized networksに加えて直接操作したが、**作業完了後に必ず`--clear-authorized-networks`で戻す**（このセッションでは戻し済み）

## 9. デプロイ後の確認 / Post-deploy verification / Verifikasi pasca-deploy

- [x] `assen-runtime`の`/.well-known/mcp.json`が200を返す（`gcloud auth print-identity-token`経由で確認済み。2026-07-24）
- [x] `POST /oauth/token-exchange`にWorkspaceログイン後のGoogle IDトークンを渡し、Assen JWTが発行される（2026-07-24、実際のブラウザログインで確認済み。手順は`scripts/get-assen-token.ts`）
- [x] 発行されたJWTを`Authorization: Bearer`で`/mcp`に渡し、`initialize`が200で成功する（2026-07-24確認済み）。Cursor/Claudeの`mcp.json`への設定手順は[`docs/team-guide.md`](team-guide.md)3.3節
- [ ] 純紹介1件・派遣1件で`analyze/confirm→draft→承認→署名済み添付→交付`が完走し、`pnpm run audit:verify`相当のチェックが通る
- [ ] GCSに`gs://assen-documents-mvp/<prefix>/<sha256>`形式でオブジェクトが存在する
- [x] Slackに通知が届く（2026-07-24、`chat.postMessage`を直接呼び`#審査完了`への投稿成功を確認済み。**実際の承認依頼イベント経由での確認は未実施**、上記の実文書フローE2Eで併せて確認すること）
- [ ] 別tenantの行が`assen_app`から読めないことを`psql`で確認（[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)D節の手順をCloud SQL上で再実施）

以上がすべて確認できた時点で、[`docs/registry-readiness-checklist.md`](registry-readiness-checklist.md)G節の残りチェックボックスを埋めること。

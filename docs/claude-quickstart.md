# Assen × Claude 接続クイックスタート（明日から使う用） / Assen × Claude quickstart (for tomorrow) / Panduan cepat Assen × Claude (untuk besok)

**この文書の位置づけ**：Claude（Claude Desktop / claude.ai / Claude Code）からAssenの本番相当環境（Cloud Run）に**明日すぐ接続して使い始める**ための最短手順です。仕組みの詳細・全ワークフロー・エラー対処は[`docs/team-guide.md`](team-guide.md)を参照してください。本書は接続手順のみに絞っています。

**前提**：Cloud Run上の`assen-runtime`は稼働中で、ワンクリックOAuth（Claude → Assen → Google Workspace → Assen JWT）が有効です。通常運用では`pnpm run auth:get-token`やBearerヘッダー手貼りは不要です。

---

## 0. 初回だけ必要なもの / One-time setup / Persiapan satu kali

- Claude Desktop / claude.ai / Claude Cowork / Claude Code のいずれかでCustom Connectorを追加できる権限
- 自分のGoogle Workspaceメールアドレス（`admin@example.co.jp`形式）が`TOKEN_EXCHANGE_ALLOWLIST_JSON`（社内allowlist）に登録済みであること。未登録の場合は壁に依頼してください

---

## 1. ClaudeにURLだけで接続する / Step 1: connect from Claude with only the URL / Langkah 1: hubungkan dari Claude hanya dengan URL

Claude Desktop / claude.ai / Cowork のUIで接続します：

```
https://assen-runtime-000000000000.asia-northeast1.run.app/mcp
```

1. Claudeで**Settings → Connectors → Add custom connector**を開く（Team/Enterprise管理者は`Admin settings → Connectors`）
2. **Remote MCP server URL**に上記の`/mcp` URLを入力する
3. Claudeが自動でOAuth discoveryを読み、Google Workspaceログイン画面を開く
4. Workspaceアカウントでログインする
5. allowlist登録済みの人だけ接続成功。以降のaccess token更新はClaude側が自動で行う

---

## 2. Claude Code（CLI）で接続する / Step 2: connect from Claude Code / Langkah 2: hubungkan dari Claude Code

Claude CodeがリモートMCP OAuthに対応している場合は、同じURLを登録します：

```bash
claude mcp add --transport http assen \
  https://assen-runtime-000000000000.asia-northeast1.run.app/mcp
```

使っているClaude CodeのバージョンでOAuth callbackがうまく動かない場合だけ、[5章](#5-トラブル時だけ手動トークンfallback--manual-token-fallback-only-for-troubleshooting--fallback-token-manual-hanya-saat-troubleshooting)の手動token fallbackを使います。

### 2-B. 動作確認

エージェントに次のように頼みます：

> Assenで使えるツールを一覧して

23個のツール（`inquiry.*`・`job_order.gate_check`/`score`/`list`・`kpi.weekly_summary`等を含む）が返れば接続成功です。有料紹介の使い方は[`docs/paid-placement-workflow.md`](paid-placement-workflow.md)を参照してください。

---

## 3. トークンが切れたら / Step 3: when the token expires / Langkah 3: saat token kedaluwarsa

Claudeがrefresh tokenで自動更新します。再ログイン画面が出た場合は、同じGoogle Workspaceアカウントで再ログインしてください。

---

## 4. 何から始めるか（明日の最初の一歩） / Where to start tomorrow / Mulai dari mana besok

接続確認ができたら、実際の業務は自然言語で頼むだけです。例：

> 求人メールを取り込んで。本文はこれです：（メール原文を貼る）

エージェントが`job_order.analyze`→（欠落項目の確認）→`job_order.confirm`→`compliance.evaluate`の順に自動で進めます。各ステップで何が起きているかは[`docs/team-guide.md`](team-guide.md)5章・6章を参照してください。

**必ず守ること**：Assenが生成する文書は常にドラフトです。人間が`document.approve`で承認するまで法的に確定しません。`ambiguous`／`expert_review_required`のfindingsが出た場合は、AIに何を指示しても承認を通せません（意図的な設計）。専門家に相談してください（[`docs/team-guide.md`](team-guide.md)9章・12章参照）。

---

## 5. トラブル時だけ：手動トークンfallback / Manual token fallback only for troubleshooting / Fallback token manual hanya saat troubleshooting

通常は不要です。Claude側のOAuth callbackが失敗する時だけ、旧手順でBearer tokenを取得します：

```bash
cd assen
export GOOGLE_OAUTH_CLIENT_ID="000000000000-REDACTED.apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="<Secret Managerの値を壁に確認>"
export ASSEN_BASE_URL="https://assen-runtime-000000000000.asia-northeast1.run.app"
pnpm run auth:get-token
```

取得したtokenは8時間有効です。Slack・チケット・スクリーンショットには貼らないでください。

---

## 6. セキュリティ上の注意（本番相当環境固有） / Security notes specific to this environment / Catatan keamanan khusus lingkungan ini

- **`assen-runtime`はネットワーク的にはインターネット公開されています**（Cloud Run IAM invokerは`allUsers`）。実質的なアクセス制御はアプリ層OAuth（`TOKEN_EXCHANGE_ALLOWLIST_JSON`に登録されたWorkspaceメールのみ）に完全に依存しています。IAP/VPNのようなネットワーク層の追加防御は現時点で意図的に見送っています（[`docs/ops-runbook.md`](ops-runbook.md)8節参照）
- 手動fallbackで取得したアクセストークンをSlack・チケット・スクリーンショットに貼らないこと（8時間有効な認証情報です）
- 自分のトークンを他の人と共有しないこと（`approved_by`等はトークンから自動導出されるため、共有はなりすましと同義です）
- 在留カード・パスポート等の画像をAssen経由でアップロード・保存しようとしないこと（Assenのスコープ外）

---

## 7. 困ったときは / Where to ask for help / Ke mana harus bertanya jika ada masalah

- 接続できない・トークンエラー：まずこの手順書の手順1〜3を再確認。解決しなければSlack `#90_dev`
- 業務的な質問（求人取込・承認・期限）：Slack `#20_派遣管理`
- 法令解釈・findingsの是正方法：社労士・弁護士へのエスカレーション

その他の詳細（全ワークフロー・エラー対処表・用語集）は[`docs/team-guide.md`](team-guide.md)、構築の実履歴は[`docs/ops-runbook.md`](ops-runbook.md)を参照してください。

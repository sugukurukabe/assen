# Assen × Claude 接続クイックスタート（明日から使う用） / Assen × Claude quickstart (for tomorrow) / Panduan cepat Assen × Claude (untuk besok)

**この文書の位置づけ**：Claude（Claude Desktop / claude.ai / Claude Code）からAssenの本番相当環境（Cloud Run）に**明日すぐ接続して使い始める**ための最短手順です。仕組みの詳細・全ワークフロー・エラー対処は[`docs/team-guide.md`](team-guide.md)を参照してください。本書は接続手順のみに絞っています。

**前提**：2026-07-24時点でCloud Run上の`assen-runtime`は稼働中、OAuthトークン交換層も実際のGoogle Workspaceログインで動作確認済みです（[`docs/ops-runbook.md`](ops-runbook.md)参照）。トークンの有効期限は**8時間**（1日の勤務時間をカバーする設定に変更済み）。

---

## 0. 初回だけ必要なもの / One-time setup / Persiapan satu kali

- このリポジトリ（`aios`）がローカルにclone済みで、`apps/compliance`で`pnpm install`済みであること
- Node.js 20以上・`pnpm`が使えること
- `GOOGLE_OAUTH_CLIENT_SECRET`の値（壁に確認してください。Slack等の平文には貼らないこと）
- 自分のGoogle Workspaceメールアドレス（`admin@example.co.jp`形式）が`TOKEN_EXCHANGE_ALLOWLIST_JSON`（社内allowlist）に登録済みであること。未登録の場合は壁に依頼してください

---

## 1. Assenアクセストークンを取得する / Step 1: get an Assen access token / Langkah 1: dapatkan access token Assen

ターミナルで`apps/compliance`ディレクトリに移動し、以下を実行します：

```bash
cd aios/apps/compliance
export GOOGLE_OAUTH_CLIENT_ID="000000000000-REDACTED.apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="<壁に確認した値>"
export ASSEN_BASE_URL="https://assen-runtime-000000000000.asia-northeast1.run.app"
pnpm run auth:get-token
```

ブラウザが自動で開くので、Google Workspaceアカウントでログインします。ターミナルに以下のような出力が出ます：

```
Assenアクセストークンを取得しました / Assen access token acquired:
eyJhbGciOiJFUzI1NiIs...（長い文字列）

有効期限 / expires in: 28800秒 / seconds
```

この`eyJ...`から始まる長い文字列（アクセストークン）をコピーします。**8時間有効**です。

**エラーが出た場合**：「許可されていません」的なエラーが出たら、自分のemailがallowlist未登録です。壁に依頼してください。ブラウザが開かない場合は、ターミナルに表示されたURLを手動でコピーして開いてください。

---

## 2. Claudeに接続する / Step 2: connect from Claude / Langkah 2: hubungkan dari Claude

**使っているクライアントによって手順が異なります。** どの方法でも上でコピーしたトークンを`Authorization`ヘッダーの値として`Bearer <トークン>`の形式で使います（`Bearer `の後にスペースを1つ入れてトークンを続ける）。

### 2-A. Claude Desktop / claude.ai（Webブラウザ版）— 推奨・最も簡単

⚠️ `claude_desktop_config.json`をテキストエディタで直接編集する方法は**使えません**（`url`/`headers`フィールドを受け付けず、設定が壊れることがあります）。代わりにUIから設定します：

1. Claude Desktopまたはclaude.aiで**Settings → Connectors**を開く（会社アカウントの管理者権限がある場合は`Admin settings → Connectors`）
2. **「Add custom connector」**をクリック
3. **Remote MCP server URL**に以下を入力：
   ```
   https://assen-runtime-000000000000.asia-northeast1.run.app/mcp
   ```
4. **Request headers**セクションを開き、以下を追加：
   - Header name: `authorization`
   - Header value: `Bearer <手順1でコピーしたトークン>`（`Bearer `の後のスペースを忘れないこと）
   - Required: ON
5. **「Add」**をクリックして保存する（保存後、Claudeはヘッダー値を再表示しません。トークンが変わったら値を上書き保存し直してください）

### 2-B. Claude Code（CLI）を使っている場合

```bash
claude mcp add --transport http assen \
  https://assen-runtime-000000000000.asia-northeast1.run.app/mcp \
  --header "Authorization: Bearer <手順1でコピーしたトークン>"
```

### 2-C. 動作確認

エージェントに次のように頼みます：

> Assenで使えるツールを一覧して

15個のツール（`job_order.analyze`〜`placement.record_rejection_reason`）が返れば接続成功です。

---

## 3. トークンが切れたら（8時間後） / Step 3: when the token expires / Langkah 3: saat token kedaluwarsa

1. 手順1を再実行して新しいトークンを取得する
2. **Claude Desktop/claude.ai**：Settings → Connectors → 該当のconnectorを開き、Request headersの`authorization`値を新しいトークンで上書き保存する
3. **Claude Code**：`claude mcp remove assen` → 手順2-Bを新しいトークンで再実行する（またはヘッダー更新に対応していれば上書き）

「トークンが切れたかも」と感じたら、エージェントに何か聞いてみて`401`や認証エラーが返れば切れています。

---

## 4. 何から始めるか（明日の最初の一歩） / Where to start tomorrow / Mulai dari mana besok

接続確認ができたら、実際の業務は自然言語で頼むだけです。例：

> 求人メールを取り込んで。本文はこれです：（メール原文を貼る）

エージェントが`job_order.analyze`→（欠落項目の確認）→`job_order.confirm`→`compliance.evaluate`の順に自動で進めます。各ステップで何が起きているかは[`docs/team-guide.md`](team-guide.md)5章・6章を参照してください。

**必ず守ること**：Assenが生成する文書は常にドラフトです。人間が`document.approve`で承認するまで法的に確定しません。`ambiguous`／`expert_review_required`のfindingsが出た場合は、AIに何を指示しても承認を通せません（意図的な設計）。専門家に相談してください（[`docs/team-guide.md`](team-guide.md)9章・12章参照）。

---

## 5. セキュリティ上の注意（本番相当環境固有） / Security notes specific to this environment / Catatan keamanan khusus lingkungan ini

- **`assen-runtime`はネットワーク的にはインターネット公開されています**（Cloud Run IAM invokerは`allUsers`）。実質的なアクセス制御はアプリ層OAuth（`TOKEN_EXCHANGE_ALLOWLIST_JSON`に登録されたWorkspaceメールのみ）に完全に依存しています。IAP/VPNのようなネットワーク層の追加防御は現時点で意図的に見送っています（[`docs/ops-runbook.md`](ops-runbook.md)8節参照）
- アクセストークンをSlack・チケット・スクリーンショットに貼らないこと（8時間有効な認証情報です）
- 自分のトークンを他の人と共有しないこと（`approved_by`等はトークンから自動導出されるため、共有はなりすましと同義です）
- 在留カード・パスポート等の画像をAssen経由でアップロード・保存しようとしないこと（Assenのスコープ外）

---

## 6. 困ったときは / Where to ask for help / Ke mana harus bertanya jika ada masalah

- 接続できない・トークンエラー：まずこの手順書の手順1〜3を再確認。解決しなければSlack `#90_dev`
- 業務的な質問（求人取込・承認・期限）：Slack `#20_派遣管理`
- 法令解釈・findingsの是正方法：社労士・弁護士へのエスカレーション

その他の詳細（全ワークフロー・エラー対処表・用語集）は[`docs/team-guide.md`](team-guide.md)、構築の実履歴は[`docs/ops-runbook.md`](ops-runbook.md)を参照してください。

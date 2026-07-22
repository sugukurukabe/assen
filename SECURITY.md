# セキュリティポリシー / Security Policy / Kebijakan Keamanan

## 対象 / Scope / Ruang lingkup

このポリシーは本リポジトリ（Assen MCPサーバー）のコードに適用されます。
This policy applies to the code in this repository (the Assen MCP server).
Kebijakan ini berlaku untuk kode di repositori ini (server MCP Assen).

## 脆弱性の報告 / Reporting a vulnerability / Melaporkan kerentanan

> ⚠️ **要確認 / TODO / Perlu konfirmasi**: 以下の連絡先はレジストリ公開・外部提供の前に、実在の受信可能な窓口（監視体制のあるメールアドレスまたはフォーム）へ更新してください。詳細は[`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md)を参照。
> The contact below must be updated to a real, monitored channel (email address or form) before this project is submitted to any public registry or offered externally. See [`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md).
> Kontak di bawah ini harus diperbarui menjadi kanal nyata yang dipantau (alamat email atau formulir) sebelum proyek ini diajukan ke registry publik mana pun atau ditawarkan secara eksternal. Lihat [`docs/registry-readiness-checklist.md`](docs/registry-readiness-checklist.md).

セキュリティ上の懸念（脆弱性・PII露出・認証バイパス等）を発見した場合は、公開Issueを作成せず、
社内Slack `#30-dev`（社外の方は管理者へ直接連絡）にご連絡ください。対応方針が決まるまで、
問題の詳細を公開しないようお願いします。

If you discover a security concern (vulnerability, PII exposure, authentication bypass, etc.), please do not open
a public issue. Instead, contact us via the internal Slack channel `#30-dev` (external reporters should contact
the project administrator directly). Please do not publicly disclose details until a resolution is agreed upon.

Jika Anda menemukan masalah keamanan (kerentanan, kebocoran PII, bypass otentikasi, dll.), harap jangan membuat
issue publik. Silakan hubungi kami melalui kanal Slack internal `#30-dev` (pelapor eksternal harap menghubungi
administrator proyek secara langsung). Harap tidak mengungkapkan detail secara publik sampai penyelesaian disepakati.

## 対応目標 / Response targets / Target respons

| 深刻度 / Severity / Tingkat keparahan | 初回応答 / First response / Respons pertama | 修正目標 / Fix target / Target perbaikan |
|---|---|---|
| Critical（PII漏洩・認証バイパス・RLSバイパス等） | 1営業日 / 1 business day / 1 hari kerja | 7日以内 / within 7 days / dalam 7 hari |
| High（権限昇格・DoS等） | 2営業日 / 2 business days / 2 hari kerja | 14日以内 / within 14 days / dalam 14 hari |
| Medium/Low | 5営業日 / 5 business days / 5 hari kerja | 次回リリースまで / by next release / rilis berikutnya |

## 取り扱う機密性の高いデータ / Sensitive data handled / Data sensitif yang ditangani

- 求職者・求人企業のPII（氏名、連絡先等）— 保管時はアプリ層でAES-256-GCM暗号化（`PII_ENCRYPTION_KEY`）
- 生成文書（労働条件通知書等）— content-addressable storageにSHA-256キーで保存し、改変検知を可能にする
- 認証トークン（`AUTH_LOCAL_TOKEN`はdev専用。本番は`AUTH_MODE=oauth`必須）

PII of job seekers and client companies (names, contact info, etc.) — encrypted at rest at the application layer
with AES-256-GCM (`PII_ENCRYPTION_KEY`). Generated documents (labor conditions notices, etc.) are stored
content-addressably keyed by SHA-256 to detect tampering. Auth tokens (`AUTH_LOCAL_TOKEN` is dev-only; production
requires `AUTH_MODE=oauth`).

PII pencari kerja dan perusahaan klien (nama, info kontak, dll.) — dienkripsi saat disimpan di lapisan aplikasi
dengan AES-256-GCM (`PII_ENCRYPTION_KEY`). Dokumen yang dihasilkan (pemberitahuan kondisi kerja, dll.) disimpan
secara content-addressable dengan kunci SHA-256 untuk mendeteksi perubahan. Token auth (`AUTH_LOCAL_TOKEN` hanya
untuk dev; produksi wajib `AUTH_MODE=oauth`).

在留カード・パスポート画像は本サーバーの対象外（スコープ外）です。もし将来的にOCR機能を追加する場合、
処理後は即座に破棄し、サーバーに保存しないこと（社内ルール §2）。
Residence-card/passport images are out of scope for this server. If OCR functionality is added in the future,
processed images must be discarded immediately and never persisted on the server (internal rule §2).
Gambar kartu izin tinggal/paspor berada di luar ruang lingkup server ini. Jika fungsi OCR ditambahkan di masa
depan, gambar yang diproses harus segera dibuang dan tidak pernah disimpan di server (aturan internal §2).

## サポート対象バージョン / Supported versions / Versi yang didukung

M1完了時点では単一のmainブランチのみを保守対象とします。バージョニング方針はM2以降で定めます。
As of M1 completion, only the single `main` branch is maintained. A formal versioning policy will be defined from M2 onward.
Sejak selesainya M1, hanya branch `main` tunggal yang dipelihara. Kebijakan versioning formal akan ditentukan mulai M2.

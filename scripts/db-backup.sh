#!/usr/bin/env bash
# ローカルDocker Compose上のPostgresをカスタム形式(-Fc)でダンプする。
# サーバー版（postgres:16-alpine）とクライアント版のズレを避けるため、pg_dumpはコンテナ内で実行する
# （ホストのpg_dumpがサーバーより古いと非対応/不完全なダンプになりうるため）。
# 本番（Cloud SQL）はCloud SQL自体の自動バックアップ/PITRが正であり、本スクリプトはローカルの復元ドリル
# （docs/registry-readiness-checklist.md D節「バックアップ復旧」）用の補助ツール
#
# Dumps the local Docker Compose Postgres in custom format (-Fc). Runs pg_dump inside the container (not the host)
# to avoid a client/server version mismatch (postgres:16-alpine vs. whatever pg_dump the host happens to have —
# an older client against a newer server is not a supported combination and can produce an incomplete dump).
# In production (Cloud SQL), Cloud SQL's own automated backups/PITR are authoritative; this script is a helper for
# the local restore drill (docs/registry-readiness-checklist.md section D, "backup recovery")
#
# Melakukan dump Postgres Docker Compose lokal dalam format custom (-Fc). Menjalankan pg_dump di dalam container
# (bukan host) untuk menghindari ketidaksesuaian versi client/server (postgres:16-alpine vs versi pg_dump host
# apa pun — client lama terhadap server baru bukan kombinasi yang didukung dan dapat menghasilkan dump yang tidak
# lengkap). Di produksi (Cloud SQL), backup otomatis/PITR milik Cloud SQL sendiri adalah yang sah; skrip ini adalah
# pembantu untuk drill restore lokal (docs/registry-readiness-checklist.md bagian D, "pemulihan backup")
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
TIMESTAMP=$(date +%Y%m%dT%H%M%S)
OUTPUT_FILE="${1:-backups/assen-${TIMESTAMP}.dump}"

echo "[db-backup] dumping the 'assen' database (custom format) to ${OUTPUT_FILE}" >&2
docker compose exec -T postgres pg_dump -U assen -d assen -Fc >"$OUTPUT_FILE"
echo "[db-backup] done. size: $(du -h "$OUTPUT_FILE" | cut -f1)" >&2

# 標準出力にはファイルパスのみを出す（他スクリプトから$(...)で受け取りやすくするため）
# stdout carries only the file path (so other scripts can capture it via $(...))
# stdout hanya membawa path file (agar skrip lain dapat menangkapnya via $(...))
echo "$OUTPUT_FILE"

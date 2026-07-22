#!/usr/bin/env bash
# 【実際の復旧用】指定したダンプファイルから'assen'データベースへ復元する（既存DBは破壊的に置き換える）。
# 平常時の動作確認には scripts/db-restore-drill.sh （'assen'を壊さず別DBへ復元して検証・後片付けまで行う）を使うこと。
# 本スクリプトは災害復旧の実演習・実際の障害対応時のみ使う想定
#
# 【For real recovery】Restores the 'assen' database from a given dump file (destructively replaces the existing DB).
# For routine drills, use scripts/db-restore-drill.sh instead (restores into a separate DB, verifies, and cleans up
# without touching 'assen'). This script is meant only for real disaster-recovery exercises or actual incidents
#
# 【Untuk pemulihan sungguhan】Memulihkan database 'assen' dari file dump yang diberikan (mengganti DB yang ada
# secara destruktif). Untuk drill rutin, gunakan scripts/db-restore-drill.sh (memulihkan ke DB terpisah, memverifikasi,
# dan membersihkan tanpa menyentuh 'assen'). Skrip ini hanya untuk latihan disaster-recovery sungguhan atau insiden nyata
set -euo pipefail
cd "$(dirname "$0")/.."

DUMP_FILE="${1:?使い方: scripts/db-restore.sh <dump-file> / Usage: scripts/db-restore.sh <dump-file>}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "[db-restore] dumpファイルが見つかりません / dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

echo "[db-restore] 警告：'assen'データベースの内容を破壊的に置き換えます / WARNING: this destructively replaces the 'assen' database" >&2
echo "[db-restore] 続行するには 'yes' と入力してください / type 'yes' to continue:" >&2
read -r CONFIRMATION
if [ "$CONFIRMATION" != "yes" ]; then
  echo "[db-restore] 中止しました / aborted" >&2
  exit 1
fi

echo "[db-restore] terminating existing connections to 'assen'" >&2
docker compose exec -T postgres psql -U assen -d postgres -c \
  "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'assen' and pid <> pg_backend_pid();"

echo "[db-restore] dropping and recreating 'assen'" >&2
docker compose exec -T postgres dropdb -U assen --if-exists assen
docker compose exec -T postgres createdb -U assen assen

echo "[db-restore] restoring from ${DUMP_FILE}" >&2
docker compose exec -T postgres pg_restore -U assen -d assen --no-owner --exit-on-error <"$DUMP_FILE"

echo "[db-restore] done. runtimeロール(assen_app)のGRANTが失われていないか、audit:verifyで確認することを推奨 / done. recommend confirming assen_app's grants survived via 'pnpm run audit:verify'" >&2

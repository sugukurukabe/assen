#!/usr/bin/env bash
# バックアップ復旧の復元試験（docs/registry-readiness-checklist.md D節「バックアップ復旧（復元試験）」）。
# 'assen'データベースは一切変更せず、別データベース（assen_restore_drill）へ復元してから
# ①主要テーブルの行数一致、②assen_appロールのGRANTが復元後も有効か、③audit_eventsのハッシュチェーンが
# 復元後も検証を通るか、を確認し、最後にドリル用DBを削除する。
#
# 使い方 / Usage / Cara pakai:
#   scripts/db-restore-drill.sh            # 新規にバックアップを取ってから試験する / takes a fresh backup first
#   scripts/db-restore-drill.sh <dump-file> # 既存のダンプファイルで試験する / drills against an existing dump file
#
# Backup-recovery restore drill (docs/registry-readiness-checklist.md section D, "backup recovery (restore drill)").
# Never touches the 'assen' database — restores into a separate database (assen_restore_drill), then checks
# (1) row counts match on key tables, (2) the assen_app role's grants survived the restore, (3) the audit_events
# hash chain still verifies after restore — then drops the drill database
#
# Drill restore pemulihan backup (docs/registry-readiness-checklist.md bagian D, "pemulihan backup (drill restore)").
# Tidak pernah menyentuh database 'assen' — memulihkan ke database terpisah (assen_restore_drill), lalu memeriksa
# (1) jumlah baris cocok pada tabel utama, (2) grant role assen_app tetap ada setelah restore, (3) rantai hash
# audit_events masih terverifikasi setelah restore — lalu menghapus database drill
set -euo pipefail
cd "$(dirname "$0")/.."

DRILL_DB="assen_restore_drill"
DUMP_FILE="${1:-}"

cleanup() {
  echo "[drill] cleaning up: dropping ${DRILL_DB}" >&2
  docker compose exec -T postgres dropdb -U assen --if-exists "$DRILL_DB" >/dev/null 2>&1 || true
  echo "[drill] cleaning up: removing demo seed data from 'assen'" >&2
  node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/drill-demo-data.ts cleanup >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[drill] seeding demo data (job_order.analyze→confirm) so the drill has non-trivial rows/audit_events to check" >&2
node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/drill-demo-data.ts seed

if [ -z "$DUMP_FILE" ]; then
  DUMP_FILE=$(scripts/db-backup.sh)
fi
echo "[drill] using dump file: ${DUMP_FILE}" >&2

echo "[drill] recreating a fresh drill database: ${DRILL_DB}" >&2
docker compose exec -T postgres dropdb -U assen --if-exists "$DRILL_DB"
docker compose exec -T postgres createdb -U assen "$DRILL_DB"

echo "[drill] restoring into ${DRILL_DB}" >&2
docker compose exec -T postgres pg_restore -U assen -d "$DRILL_DB" --no-owner --exit-on-error <"$DUMP_FILE"

FAILED=0

echo "[drill] comparing row counts (assen vs ${DRILL_DB})" >&2
TABLES=(party_snapshots source_artifacts fact_assertions job_orders job_order_referrals job_seekers fee_records dispatch_assignments dispatch_ledger_entries deadline_instances documents approval_requests audit_events transactional_outbox tenant_settings)
for TABLE in "${TABLES[@]}"; do
  ORIGINAL_COUNT=$(docker compose exec -T postgres psql -U assen -d assen -tAc "select count(*) from ${TABLE}")
  RESTORED_COUNT=$(docker compose exec -T postgres psql -U assen -d "$DRILL_DB" -tAc "select count(*) from ${TABLE}")
  if [ "$ORIGINAL_COUNT" != "$RESTORED_COUNT" ]; then
    echo "[drill] MISMATCH ${TABLE}: original=${ORIGINAL_COUNT} restored=${RESTORED_COUNT}" >&2
    FAILED=1
  else
    echo "[drill] OK ${TABLE}: ${ORIGINAL_COUNT} rows match" >&2
  fi
done

echo "[drill] checking assen_app's grants survived the restore" >&2
GRANT_CHECK=$(docker compose exec -T postgres psql -U assen -d "$DRILL_DB" -tAc \
  "select has_table_privilege('assen_app', 'job_orders', 'select') and has_table_privilege('assen_app', 'job_orders', 'insert') and not has_table_privilege('assen_app', 'audit_events', 'update')")
if [ "$(echo "$GRANT_CHECK" | tr -d '[:space:]')" != "t" ]; then
  echo "[drill] MISMATCH: assen_app grants on the restored database are not as expected" >&2
  FAILED=1
else
  echo "[drill] OK: assen_app grants (select/insert on job_orders, no update on audit_events) survived the restore" >&2
fi

echo "[drill] verifying the audit hash-chain on the restored database" >&2
set -a
# shellcheck disable=SC1091
source .env
set +a
RESTORED_MIGRATION_URL=$(printf '%s' "$MIGRATION_DATABASE_URL" | sed -E "s#/[A-Za-z0-9_]+([?].*)?\$#/${DRILL_DB}#")
if MIGRATION_DATABASE_URL="$RESTORED_MIGRATION_URL" node node_modules/tsx/dist/cli.mjs src/audit/verify-chain.ts; then
  echo "[drill] OK: audit chain verification passed on the restored database" >&2
else
  echo "[drill] MISMATCH: audit chain verification failed on the restored database" >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "[drill] RESULT: FAILED" >&2
  exit 1
fi
echo "[drill] RESULT: PASSED" >&2

#!/usr/bin/env bash
# Проверка миграций без Docker: чистая база на локальном Postgres 15+ (с pgvector и pgTAP),
# шим окружения Supabase → все миграции по порядку → seed.sql → pgTAP-тесты.
# Полная проверка в настоящем Supabase — `supabase db reset && supabase test db` (CI, job db).
#
#   PGURL=postgres://localhost/postgres packages/db/scripts/check-migrations.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../supabase"
db="all_manager_check_$$"
base="${PGURL:-postgres:///postgres}"
url="${base%/*}/$db"

cleanup() { psql "$base" -qc "drop database if exists $db" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$base" -qc "create database $db" >/dev/null
psql "$url" -q -v ON_ERROR_STOP=1 -f "$here/supabase-shim.sql" >/dev/null
for f in "$root"/migrations/*.sql; do
  echo "→ $(basename "$f")"
  # pgmq и pg_cron в шиме — схемы-заглушки, а не расширения
  sed -E '/create extension if not exists (pgmq|pg_cron)/d' "$f" | psql "$url" -q -v ON_ERROR_STOP=1 >/dev/null
done
echo "→ seed.sql"
psql "$url" -q -v ON_ERROR_STOP=1 -f "$root/seed.sql" >/dev/null

fail=0
for t in "$root"/tests/*.sql; do
  echo "→ $(basename "$t")"
  out="$(psql "$url" -X -q -At -v ON_ERROR_STOP=1 -f "$t" 2>&1)" || { echo "$out"; fail=1; continue; }
  echo "$out" | grep -E "^(ok|not ok|# )" || true
  if echo "$out" | grep -qE "^not ok|Looks like"; then fail=1; fi
done
[ "$fail" = 0 ] && echo "OK: миграции применяются, тесты проходят" || { echo "FAIL"; exit 1; }

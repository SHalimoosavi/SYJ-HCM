#!/usr/bin/env bash
set -euo pipefail

SOURCE_URL="${DATABASE_MIGRATION_URL:-${DATABASE_URL:-}}"
RUNTIME_URL="${DATABASE_RUNTIME_URL:-${DATABASE_URL:-}}"
if [[ -z "$SOURCE_URL" ]]; then echo "DATABASE_MIGRATION_URL or DATABASE_URL is required" >&2; exit 1; fi
if [[ -z "$RUNTIME_URL" ]]; then echo "DATABASE_RUNTIME_URL or DATABASE_URL is required" >&2; exit 1; fi

RESTORE_DB="syj_hcm_restore_${RANDOM}_$(date +%s)"
DUMP_FILE="${TMPDIR:-/tmp}/syj-hcm-${RESTORE_DB}.dump"
BASE_URL="${SOURCE_URL%/*}"
RESTORE_URL="${BASE_URL}/${RESTORE_DB}"
RUNTIME_BASE_URL="${RUNTIME_URL%/*}"
RESTORE_RUNTIME_URL="${RUNTIME_BASE_URL}/${RESTORE_DB}"

cleanup() {
  rm -f "$DUMP_FILE"
  psql "$SOURCE_URL" -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS \"${RESTORE_DB}\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

pg_dump --format=custom --file="$DUMP_FILE" "$SOURCE_URL"
psql "$SOURCE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${RESTORE_DB}\""
pg_restore --no-owner --no-privileges --dbname="$RESTORE_URL" "$DUMP_FILE"

psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -c "SELECT count(*) > 0 AS migrations_restored FROM public.__migrations"
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS organization_count FROM public.organizations"
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -c "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('employees','candidates','applications','offers','candidate_documents') ORDER BY relname"

psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -c "GRANT CONNECT ON DATABASE \"${RESTORE_DB}\" TO app_runtime; GRANT USAGE ON SCHEMA public TO app_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO app_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_runtime"
psql "$RESTORE_RUNTIME_URL" -v ON_ERROR_STOP=1 -c "SELECT current_user, current_database(), (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS rolbypassrls"
psql "$RESTORE_RUNTIME_URL" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS rows_without_tenant_context FROM public.employees"

echo "PostgreSQL backup/restore drill completed: $RESTORE_DB"

#!/usr/bin/env bash
set -euo pipefail

matches=$(grep -RInE \
  --exclude='migrate-sqlite-to-postgres.ts' \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  'DatabaseSync|node:sqlite|better-sqlite3|withSqliteTransactionSync|sqlite\.prepare|sqlite\.exec|sqlite\.transaction|sqlite_master|PRAGMA' \
  src tests scripts || true)

if [[ -n "$matches" ]]; then
  echo "$matches"
  echo "Legacy SQLite runtime/test consumer detected."
  exit 1
fi

echo "SQLite runtime inventory: zero legacy consumers."

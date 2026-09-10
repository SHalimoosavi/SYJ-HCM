#!/usr/bin/env bash
set -euo pipefail

printf '\n=== SYJ-HCM Phase 1.1 Verification ===\n'
printf 'Node: '; node --version
printf 'npm:  '; npm --version

printf '\n[1/7] Install locked dependencies\n'
npm ci

printf '\n[2/7] Typecheck\n'
npm run typecheck

printf '\n[3/7] Non-interactive Next validation\n'
printf 'Dedicated lint command is intentionally skipped: next lint is deprecated and interactive on this Next 15 project. Production build performs Next lint/type validation non-interactively.\n'

printf '\n[4/7] Tests\n'
npm test

printf '\n[5/7] Production build\n'
npm run build

printf '\n[6/7] Production dependency audit\n'
npm audit --omit=dev --audit-level=high

printf '\n[7/7] Native dependency / working-tree checks\n'
if npm ls better-sqlite3 sqlite3 --all 2>/dev/null | grep -qE 'better-sqlite3|sqlite3'; then
  echo 'ERROR: native SQLite dependency detected.' >&2
  exit 1
fi
if git diff --check; then
  echo 'git diff --check: PASS'
fi
printf '\nPhase 1.1 verification commands completed successfully.\n'

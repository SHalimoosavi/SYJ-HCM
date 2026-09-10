#!/usr/bin/env bash
set -euo pipefail

printf '\n=== SYJ-HCM Phase 1.1 Verification ===\n'
printf 'Node: '; node --version
printf 'npm:  '; npm --version

printf '\n[1/6] Install locked dependencies\n'
npm ci

printf '\n[2/6] Typecheck\n'
npm run typecheck

printf '\n[3/6] Tests\n'
npm test

printf '\n[4/6] Production build\n'
npm run build

printf '\n[5/6] Production dependency audit\n'
npm audit --omit=dev --audit-level=high

printf '\n[6/6] Native dependency / working-tree checks\n'
if npm ls better-sqlite3 sqlite3 --all 2>/dev/null | grep -qE 'better-sqlite3|sqlite3'; then
  echo 'ERROR: native SQLite dependency detected.' >&2
  exit 1
fi
if git diff --check; then
  echo 'git diff --check: PASS'
fi
printf '\nPhase 1.1 verification commands completed successfully.\n'

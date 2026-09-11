# Phase 1.2b Release Bundle Notice

This archive is the complete SYJ-HCM Phase 1.2b repository for version `0.9.4-alpha`.

Baseline:
- Repository: `SHalimoosavi/SYJ-HCM`
- Baseline `main`: `d6aee8db8a159c1be88f20e360fd27754894735f`
- Phase: `1.2b Organization / Tenant Management`

The archive is intended for local review, validation, handoff, and release preparation.

Excluded from the archive:
- `.git/`
- `node_modules/`
- `.next/`
- `.env` and environment secrets
- local SQLite databases and other local runtime artifacts

Validation completed on the working repository:
- `npm ci` — PASS
- `npm test` — PASS (56/56)
- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm audit --audit-level=high` — PASS (0 high/critical)
- `git diff --check` — PASS

This bundle does not push, merge, or tag GitHub.

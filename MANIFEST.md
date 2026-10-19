# SYJ-HCM v0.14.1-alpha — PostgreSQL Application Migration Manifest

Baseline: `v0.14.0-alpha` / `7fd35f905b8fa5ad9a6ad0473858b138e745fd4f`

Current review gate: **PR #5 — OPEN**

## PostgreSQL foundation and runtime

- `package.json` — PostgreSQL runtime scripts, SQLite import command, backup/restore drill, deterministic repository lint gate.
- `src/db/client.ts` — Drizzle/Postgres.js runtime client and transaction-local `app.current_org_id` helper; no SQLite compatibility exports remain.
- `src/db/schema.ts` — PostgreSQL `pg-core` schema, native booleans and PostgreSQL timestamps.
- `src/lib/session.ts` — asynchronous PostgreSQL session/bootstrap path.
- `src/lib/audit.ts` — PostgreSQL audit transactions.
- `src/lib/login-rate-limit.ts` — PostgreSQL login rate limiting.
- `src/app/login/actions.ts` — asynchronous PostgreSQL authentication path.
- `drizzle.config.ts` — PostgreSQL Drizzle configuration.
- `scripts/migrate.ts` — PostgreSQL migration runner with migration ledger and advisory lock.
- `scripts/start.ts` — PostgreSQL startup validation and RLS checks.

## Application migration

- Employee, department, organization, attendance, leave, recruitment, interviews, candidate documents, publishing, offers, audit, sessions, rate limiting and server-action database paths are being validated against PostgreSQL.
- `src/lib/public-recruitment.ts` — anonymous careers/application flow uses the narrow `resolve_job_publication()` bootstrap.
- `drizzle/postgres/0011_public_recruitment_bootstrap.sql` — extends the public bootstrap with only the metadata required to complete anonymous application intake without bypassing RLS.
- Phase 2.5 offer functionality remains part of the migration target; no offer redesign is introduced.

## Data portability and operations

- `scripts/migrate-sqlite-to-postgres.ts` — read-only SQLite source importer with deterministic table ordering, type conversion, row reporting, dry-run support and transactional destination import.
- `tests/sqlite-to-postgres-migration.test.ts` — executes a representative real SQLite→PostgreSQL import and verifies safe rerun behavior.
- `scripts/backup-restore-drill.sh` — disposable PostgreSQL custom-format backup/restore validation with runtime-role verification.
- `scripts/check-no-sqlite-runtime.sh` — release gate for legacy SQLite runtime consumers.

## Test migration

Database-dependent tests are being converted to PostgreSQL rather than preserving SQLite adapters. This includes recruitment workflow, recruitment foundation, job publishing, organization management, concurrency invariants, security constraints, tenant isolation, candidate documents and migration drills.

The test bootstrap provisions isolated PostgreSQL test databases; production `DATABASE_URL` must never be used for destructive test setup.

## RLS / tenant security

Tenant-scoped transactions use transaction-local context. Application-layer authorization remains mandatory. The runtime role must remain `NOBYPASSRLS`.

The release gate covers cross-tenant SELECT/INSERT/UPDATE/DELETE behavior, missing tenant context, connection-pool isolation, public recruitment bootstrap boundaries, session bootstrap and offer/document ownership.

## Historical migration preservation

Historical SQLite migrations `0000`–`0009` remain preserved as source history. PostgreSQL runtime migrations are maintained separately under `drizzle/postgres/` and currently extend through `0011_public_recruitment_bootstrap.sql`.

No historical migration was reordered or silently replaced.

## Documentation

- `README.md` — PostgreSQL runtime architecture and operational commands.
- `MIGRATION.md` — migration, RLS, public bootstrap, data portability and backup/restore procedures.
- `.env.example` — separated runtime/migration database configuration.
- `.github/workflows/ci.yml` — PostgreSQL 16 release validation pipeline.

## Release state

No final release tag has been created. PR #5 must remain open until CI, typecheck, lint, full tests, PostgreSQL integration/RLS validation, zero runtime SQLite inventory, data migration drill, backup/restore drill, production build and security/dependency checks are genuinely green.

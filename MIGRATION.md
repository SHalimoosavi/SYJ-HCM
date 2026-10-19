# SYJ-HCM PostgreSQL Application Migration

## Baseline

- Release: `v0.14.0-alpha`
- Commit: `7fd35f905b8fa5ad9a6ad0473858b138e745fd4f`
- PostgreSQL foundation: `v0.14.1-alpha`
- Historical SQLite migrations: `drizzle/0000_init.sql` through `drizzle/0009_phase2_5_offer_management.sql`
- PostgreSQL application migrations: `drizzle/postgres/0000` through `0011_public_recruitment_bootstrap.sql`

The original SQLite migration files are preserved as historical source artifacts. They are not application runtime migrations.

## Architecture

Application requests use PostgreSQL through Drizzle/Postgres.js. Tenant identity is resolved from authenticated server-side session context. Tenant-scoped transactions call `SET LOCAL app.current_org_id = <organizationId>` before protected queries. PostgreSQL RLS is defense-in-depth; application-layer authorization remains mandatory.

The runtime role must be `NOBYPASSRLS` and must not own tenant tables. `DATABASE_MIGRATION_URL` is reserved for the schema/migration owner.

## Prerequisites

- PostgreSQL 16.
- Node.js >= 22.5.
- npm.
- Migration/schema owner for `DATABASE_MIGRATION_URL`.
- Runtime role for `DATABASE_URL`, with `NOBYPASSRLS`.

## Environment

```dotenv
DATABASE_URL=postgresql://app_runtime:change-me@localhost:5432/syj_hcm
DATABASE_MIGRATION_URL=postgresql://postgres:postgres@localhost:5432/syj_hcm
DATABASE_RUNTIME_ROLE=app_runtime
SESSION_SECRET=replace-with-a-long-random-value
ALLOW_DEV_SEED=false
```

## Apply migrations

```bash
npm ci
npm run db:migrate
npm run typecheck
npm test
npm run build
```

The migration runner records applied migrations in `__migrations`, applies PostgreSQL migration files in lexical order, and protects the migration transaction with an advisory lock. Historical `0000`–`0009` SQLite migrations are not executed by the PostgreSQL runtime.

## SQLite → PostgreSQL data portability

The source database is opened read-only by `scripts/migrate-sqlite-to-postgres.ts`.

```bash
SQLITE_SOURCE_PATH=/secure/legacy/app.db \
DATABASE_MIGRATION_URL=postgresql://postgres:...@localhost:5432/syj_hcm \
npm run db:import-sqlite -- --dry-run

SQLITE_SOURCE_PATH=/secure/legacy/app.db \
DATABASE_MIGRATION_URL=postgresql://postgres:...@localhost:5432/syj_hcm \
npm run db:import-sqlite
```

The importer validates the source/destination schema, converts booleans/timestamps/numerics, preserves source IDs, processes foreign-key-sensitive tables in a deterministic order, reports source/inserted/skipped/rejected counts, and aborts the destination transaction when a row is rejected. `SQLITE_IMPORT_TABLES` can restrict an import for controlled drills.

The source SQLite file is never modified or deleted.

## Public recruitment bootstrap

Anonymous publication lookup uses the narrowly scoped `resolve_job_publication(slug)` `SECURITY DEFINER` function. It returns only publication/job metadata required by the public careers/application flow. The function pins `search_path` to `public, pg_temp`, is revoked from `PUBLIC`, and is granted explicitly to the configured runtime role.

Public application writes establish tenant context inside a transaction before creating candidates, applications, history, activities, audit records, and rate-limit state.

## RLS verification

Use the actual runtime role, not the migration owner:

```sql
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;

BEGIN;
SELECT set_config('app.current_org_id', 'org_a', true);
SELECT organization_id, id FROM employees;
COMMIT;

SELECT organization_id, id FROM employees;
```

Without a tenant context, protected tenant queries must return zero rows. Repeating the transaction with `org_b` must never expose `org_a`. Pool reuse and concurrent requests must preserve this isolation because the context is transaction-local.

## Authentication bootstrap

- `resolve_login_user(text)` — minimal pre-auth account lookup.
- `resolve_session(text)` — session cookie to server-side organization/user resolution.
- `resolve_job_publication(text)` — anonymous published-career lookup.

These bootstrap functions do not replace application authorization and do not accept a client-supplied organization ID as an authorization decision.

## Backup and restore drill

The repository includes:

```bash
npm run db:backup-drill
```

The drill creates a PostgreSQL custom-format backup with `pg_dump`, restores it into a clean temporary database using `pg_restore`, verifies the migration ledger and representative schema/RLS state, and removes the temporary database. The drill must be executed against a disposable validation database; do not run it against production without an approved operational window.

## CI release gate

The PR workflow is the release gate. It installs locked dependencies, starts PostgreSQL 16, creates an `NOBYPASSRLS` runtime role, applies migrations, runs typecheck, lint, foundation tests, the complete test suite, production build, and dependency audit.

A red or incomplete CI run means the PostgreSQL cutover is **not production-ready**.

## Rollback

1. Preserve an immutable copy of the v0.14.0-alpha source database and application release.
2. Treat the PostgreSQL database as disposable until the cutover validation is complete.
3. If a validation gate fails, stop the cutover and retain the failed PostgreSQL database for investigation.
4. Never modify or delete the source SQLite database during portability work.
5. Do not merge the migration PR while any required production gate is red.

## Current validation status

This branch is still under PR #5 production validation. The repository must not claim a completed cutover until the complete CI workflow, PostgreSQL integration tests, tenant/RLS isolation tests, data-import drill, backup/restore drill, typecheck, lint, full test suite, production build, and dependency/security checks are green.

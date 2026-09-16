# SYJ-HCM PostgreSQL Foundation Migration

## Baseline

- Release: `v0.14.0-alpha`
- Commit: `7fd35f905b8fa5ad9a6ad0473858b138e745fd4f`
- Target version: `0.14.1-alpha`
- Historical SQLite migrations: `drizzle/0000_init.sql` through `drizzle/0009_phase2_5_offer_management.sql`
- PostgreSQL migration path: `drizzle/postgres/0000` through `0010_postgres_foundation.sql`

The original SQLite migration files are preserved unchanged. PostgreSQL never executes them.

## Prerequisites

- PostgreSQL 16 recommended/reference version.
- Node.js >= 22.5.
- npm.
- Two database roles are strongly recommended:
  - schema/migration owner, used by `DATABASE_MIGRATION_URL`;
  - application runtime role, used by `DATABASE_URL`, with `NOBYPASSRLS` and not owning the tables.
- The runtime role should be named `app_runtime` unless `DATABASE_RUNTIME_ROLE` is changed.

## Local PostgreSQL example

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: syj_hcm
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d syj_hcm"]
      interval: 5s
      timeout: 5s
      retries: 10
```

Create a runtime role before migrations:

```sql
CREATE ROLE app_runtime LOGIN PASSWORD 'change-me' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE syj_hcm TO app_runtime;
```

## Environment

```dotenv
DATABASE_URL=postgresql://app_runtime:change-me@localhost:5432/syj_hcm
DATABASE_MIGRATION_URL=postgresql://postgres:postgres@localhost:5432/syj_hcm
DATABASE_RUNTIME_ROLE=app_runtime
SESSION_SECRET=replace-with-a-long-random-value
ALLOW_DEV_SEED=false
```

`DATABASE_MIGRATION_URL` must be owned by the schema/migration role so the security-definer bootstrap functions are not owned by the runtime role.

## Apply

From the repository root:

```bash
npm ci
npm run db:migrate
npm run typecheck
npm test
npm run build
```

The hand-rolled runner creates/uses `__migrations`, applies PostgreSQL files in lexical filename order, and uses a PostgreSQL advisory transaction lock. The sequence is the ten historical phases (`0000`–`0009`) followed by `0010_postgres_foundation.sql`.

## RLS verification

Connect as the actual `app_runtime` role, not the migration owner/superuser, and verify:

```sql
SELECT * FROM employees;
SELECT * FROM resolve_session('a-real-session-id');

BEGIN;
SELECT set_config('app.current_org_id', 'org_a', true);
SELECT organization_id, id FROM employees;
COMMIT;

SELECT * FROM employees;
```

The first and final tenant query must return zero rows without a tenant context. The scoped query must return only `org_a` rows. Repeat with `org_b` and verify there is no connection-pool bleed.

Verify the runtime role has `NOBYPASSRLS` and is not the owner:

```sql
SELECT rolname, rolsuper, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
```

## Bootstrap functions

- `resolve_login_user(text)` — minimal pre-auth account/password-verification lookup required because users are RLS-protected.
- `resolve_session(text)` — session cookie → organization/user lookup before tenant context exists.
- `resolve_job_publication(text)` — anonymous published-career slug → minimum public publication information.

All three are `SECURITY DEFINER`, pin `search_path` to `public, pg_temp`, are explicitly revoked from `PUBLIC`, and are granted only to the configured runtime role when that role exists during migration.

## Rollback

This foundation is additive to the repository and does not destroy the source SQLite database.

Before production adoption:

1. Keep an immutable copy of the v0.14.0-alpha SQLite database and application release.
2. Treat the PostgreSQL database as disposable until migration and application validation are complete.
3. If PostgreSQL validation fails, stop the cutover and restore deployment configuration to the prior SQLite release.
4. Do not run destructive SQL against the source SQLite database.
5. Keep the failed PostgreSQL database available for investigation rather than overwriting it.

A future production data-portability tool (Prompt B/data migration work) must take its own verified source backup before copying data.

## Validation status for this build environment

**PostgreSQL integration validation could not be executed in this environment.** No PostgreSQL server/client was available, and external npm registry access was unavailable, so `postgres` could not be installed here.

Therefore this artifact does **not** claim successful PostgreSQL migration execution, RLS integration tests, typecheck, test-suite execution, or production build execution.

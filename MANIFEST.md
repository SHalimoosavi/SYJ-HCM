# SYJ-HCM v0.14.1-alpha — PostgreSQL Foundation Manifest

Baseline: `v0.14.0-alpha` / `7fd35f905b8fa5ad9a6ad0473858b138e745fd4f`

- `package.json` — bumped pre-release version and added the single PostgreSQL runtime dependency `postgres`.
- `package-lock.json` — updated root version/dependency lock metadata for `postgres` 3.4.9.
- `src/db/client.ts` — replaced `node:sqlite`/SQLite proxy with postgres.js + Drizzle PostgreSQL and added tenant-context transaction helper; retained fail-fast compatibility exports for Prompt B's unmigrated call sites.
- `src/db/schema.ts` — converted all tables from `sqlite-core` to `pg-core`, native booleans, and timezone-aware PostgreSQL timestamps while preserving the v0.14.0-alpha model including offers.
- `src/lib/session.ts` — converted the authentication/session database path to asynchronous PostgreSQL, including `resolve_session()` bootstrap and transaction-local tenant context.
- `src/lib/audit.ts` — converted the login-path audit writer to PostgreSQL transactions; synchronous legacy API now fails explicitly until Prompt B migration.
- `src/lib/login-rate-limit.ts` — converted login rate-limit persistence to asynchronous PostgreSQL tagged-template queries.
- `src/app/login/actions.ts` — converted the login path to the PostgreSQL bootstrap identity lookup and async rate limiting/session/audit transaction.
- `src/middleware.ts` — removed the stale SQLite-specific runtime comment; middleware remains database-free on the Edge runtime.
- `drizzle.config.ts` — switched Drizzle configuration to PostgreSQL and `DATABASE_URL`.
- `.env.example` — documented runtime/migration PostgreSQL connection roles and safe configuration.
- `scripts/migrate.ts` — rewrote the hand-rolled migration runner for PostgreSQL with the existing `__migrations` ledger pattern and advisory migration lock.
- `scripts/start.ts` — rewrote fail-closed startup checks against PostgreSQL and verifies required RLS coverage.
- `.github/workflows/ci.yml` — added PostgreSQL 16 service, health check, dedicated runtime role and migration environment.
- `README.md` — replaced SQLite setup guidance with PostgreSQL architecture, RLS, bootstrap and rollback documentation.
- `drizzle/postgres/0000_init.sql` — PostgreSQL translation of historical migration 0000.
- `drizzle/postgres/0001_phase1_1_security.sql` — PostgreSQL translation of historical migration 0001 schema changes; integrity triggers are installed in the PostgreSQL foundation layer.
- `drizzle/postgres/0002_attendance_clock_order_insert_guard.sql` — PostgreSQL historical phase marker/schema path for migration 0002.
- `drizzle/postgres/0003_multi_tenant_foundation.sql` — PostgreSQL translation of historical tenant foundation migration 0003.
- `drizzle/postgres/0004_phase1_2c_productization.sql` — PostgreSQL translation of productization migration 0004.
- `drizzle/postgres/0005_phase2_1_recruitment_foundation.sql` — PostgreSQL translation of recruitment foundation migration 0005.
- `drizzle/postgres/0006_phase2_2_recruitment_workflow_interviews.sql` — PostgreSQL translation of workflow/interview migration 0006.
- `drizzle/postgres/0007_phase2_3_candidate_documents.sql` — PostgreSQL translation of candidate-document migration 0007.
- `drizzle/postgres/0008_phase2_4_job_publishing.sql` — PostgreSQL translation of public job publishing migration 0008.
- `drizzle/postgres/0009_phase2_5_offer_management.sql` — PostgreSQL translation of already-released Phase 2.5 offer migration 0009; no Phase 2.5 redesign.
- `drizzle/postgres/0010_postgres_foundation.sql` — PostgreSQL-native boolean/timestamp conversion, integrity trigger functions, RLS policies, runtime grants, and narrow security-definer bootstrap functions.
- `MIGRATION.md` — foundation prerequisites, environment/role setup, exact apply sequence, RLS verification and rollback procedure.
- `MANIFEST.md` — this complete change inventory.

## Intentionally not migrated in Foundation A

The remaining application-wide synchronous SQLite call sites are deliberately deferred to **Prompt B**, as explicitly scoped by Build Prompt A. They have no SQLite implementation behind them anymore: the temporary `sqlite`/`withSqliteTransactionSync` compatibility exports in `src/db/client.ts` fail closed if an unmigrated path is invoked. This is not a claim that the entire application is PostgreSQL-runtime complete yet.

No Git tag was created, no Git history was modified, and nothing was pushed.

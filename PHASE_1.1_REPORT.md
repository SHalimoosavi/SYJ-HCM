# SYJ-HCM — Phase 1.1 Production Hardening / Phase 1.2a Tenant Follow-up

## Repository baseline

The Phase 1.1 hardening was merged into `main` before this follow-up. The current source confirms the hardened authentication, RBAC, transaction, attendance, leave, audit and startup controls described below.

This document has been reconciled with the current source tree and now also records the Phase 1.2a tenant foundation added after the Phase 1.1 release.

## 1. Phase 1.1 authentication

### Current implementation

- `src/lib/session.ts` uses DB-backed sessions with a seven-day absolute lifetime and a 24-hour idle lifetime.
- Sessions track `last_active_at` and are touched at a bounded interval.
- `src/lib/login-rate-limit.ts` stores failed-login state in SQLite.
- `src/app/login/actions.ts` uses generic credential errors and audits failed attempts.
- Password rotation creates a replacement session and removes previous sessions.
- `src/app/(app)/profile/actions.ts` exposes sign-out-other-sessions.

### Tenant follow-up

Session rows now also carry `organization_id`. The authenticated user's organization is resolved from the session/user database relationship; the browser cookie does not carry a trusted tenant identifier.

The only intentionally pre-auth unscoped identity lookup remains the login lookup by email. There is no authenticated tenant context at that point. Once the account is found, its persisted `organization_id` is used for rate limiting, session creation and audit logging.

## 2. Phase 1.1 authorization / RBAC

### Current implementation

- `src/lib/auth.ts` remains the server-side page and Server Action authorization boundary.
- `src/lib/authorization.ts` contains the role matrix and ownership helpers.
- Authorization failures are audited.

### Phase 1.2a change

The authorization matrix now explicitly documents `same_organization` as a required dimension. `canCancelLeave()` and `canAccessOwnEmployeeRecord()` reject cross-organization contexts before role/ownership checks succeed.

## 3. Phase 1.1 database integrity

The existing migration chain remains immutable:

- `drizzle/0000_init.sql`
- `drizzle/0001_phase1_1_security.sql`
- `drizzle/0002_attendance_clock_order_insert_guard.sql`

The new tenant migration is:

- `drizzle/0003_multi_tenant_foundation.sql`

The custom migration runner in `scripts/migrate.ts` continues to execute each migration and its ledger write inside a SQLite transaction.

## 4. Phase 1.2a organization model

### Files

- `src/db/schema.ts`
- `src/lib/tenant.ts`
- `drizzle/0003_multi_tenant_foundation.sql`
- `scripts/seed.ts`
- `scripts/start.ts`

### Model

`organizations` is the tenant root with:

- `id`
- `name`
- `slug`
- `status`
- `created_at`
- `updated_at`

`organization_id` is required on:

- departments
- users
- sessions
- login_rate_limits
- employees
- leave_types
- leave_balances
- leave_requests
- attendance_records
- audit_logs

### Existing-data migration strategy

The migration creates a single `org_default` organization, renames the legacy tables, creates tenant-aware replacements, copies every existing row with `organization_id = 'org_default'`, recreates indexes and Phase 1.1 integrity triggers, and only then drops the legacy tables.

This is intentionally more conservative than `ALTER TABLE ... ADD COLUMN ... DEFAULT`: after migration, the new column is genuinely `NOT NULL` and has no accidental application-level tenant default.

The migration was tested against a populated Phase 1.1-style database containing one row in every existing table. Row counts were preserved for all ten migrated tables, all copied rows received `org_default`, the new column was confirmed `NOT NULL`, and all seven Phase 1.1 integrity triggers were restored.

## 5. Tenant enforcement — pages and Server Actions

The following application areas now derive tenant scope from `requireUser()` / `requireRoleForAction()` and filter their database operations by `organizationId`:

- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/employees/page.tsx`
- `src/app/(app)/employees/new/page.tsx`
- `src/app/(app)/employees/[id]/page.tsx`
- `src/app/(app)/employees/actions.ts`
- `src/app/(app)/leave/page.tsx`
- `src/app/(app)/leave/actions.ts`
- `src/app/(app)/attendance/page.tsx`
- `src/app/(app)/attendance/actions.ts`
- `src/app/(app)/profile/page.tsx`
- `src/app/(app)/profile/actions.ts`
- `src/app/(app)/logout-action.ts`
- `src/lib/leave-rules.ts`
- `src/lib/session.ts`
- `src/lib/login-rate-limit.ts`
- `src/lib/audit.ts`

Cross-tenant foreign-key relationships are additionally guarded at the application boundary where IDs originate from client input (for example, employee department selection and leave cancellation/approval request IDs).

## 6. Tenant isolation tests

Added:

- `tests/tenant-isolation.test.ts`
- `tests/tenant-migration.test.ts`

The isolation test creates organizations A and B and verifies that an organization-A scoped query cannot read or mutate organization-B employee, leave, attendance, audit, session or login-rate-limit rows by ID/key manipulation.

The authorization tests also include an explicit cross-organization rejection case.

## 7. Documentation / version correction

### `README.md`

The README now documents:

- actual Phase 1.1 feature scope
- the current CI verification sequence
- the current test-case count from the repository test files
- the Phase 1.2a organization model
- server-derived tenant context
- the pre-auth login exception
- the tenant-scoped table list
- the new migration chain
- deliberately deferred Phase 1.2 work
- the proposed release tags

### `package.json`

The development version is now `0.9.3-alpha` for the tenant-foundation snapshot.

The preceding documentation/version release is `v0.9.2-alpha` and must be tagged separately before the tenant commit is applied.

## 8. Validation actually executed in this build workspace

### Passed

1. Populated-schema migration test using real Node `node:sqlite`:
   - 0000 + 0001 + 0002 applied
   - representative rows inserted into every legacy table
   - 0003 applied inside `BEGIN IMMEDIATE` / `COMMIT`
   - all ten table row counts preserved
   - all organization IDs backfilled to `org_default`
   - `employees.organization_id` confirmed NOT NULL
   - all seven Phase 1.1 integrity triggers restored

2. Fresh migration SQL execution:
   - migration SQL was executed directly against an empty in-memory SQLite database
   - tenant migration completed successfully

3. Static organization-scope scan:
   - raw SQL against tenant-scoped tables was inspected
   - application DELETE/UPDATE/SELECT paths introduced in this pass include explicit organization predicates
   - the only intentional pre-auth exception is login account lookup by email, documented above

4. TypeScript source syntax parsing:
   - all `.ts`/`.tsx` source/test files were parsed with the TypeScript compiler API available in the workspace
   - syntax diagnostics: 0

### Not executed here — must be run in the user's real checkout

The build container has no npm registry/network access and does not contain the repository's installed dependency tree or package-lock. Therefore this workspace cannot honestly claim a fresh:

- `npm ci`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm audit --omit=dev --audit-level=high`

Those commands must be run in the user's checkout before the Phase 1.2a commit/tag is treated as release-ready. The repository CI workflow is configured to run the typecheck, tests, production build and production dependency audit on push/PR.

## 9. Out of scope — deliberately not built

This pass does NOT include:

- organization settings
- organization branding
- subscriptions
- billing
- license keys
- commercial licensing
- holiday calendars
- attendance policy configuration
- leave policy configuration
- employee import/export
- notifications
- password reset
- email verification
- document management
- backup/restore automation
- monitoring/observability platform
- Recruiting / ATS
- onboarding
- expenses
- helpdesk
- performance / OKRs
- payroll
- statutory payroll rules
- analytics

These remain queued for subsequent phases.

## 10. Recommended commits

### Part 1 + Part 2 — already merged Phase 1.1 release correction

```text
chore: correct Phase 1.1 documentation and release version
```

Tag:

```bash
git tag -a v0.9.2-alpha -m "SYJ-HCM Phase 1.1 production hardening"
git push origin v0.9.2-alpha
```

### Part 3 — Phase 1.2a

```text
feat: add multi-tenant foundation and tenant isolation
```

Tag after validation:

```bash
git tag -a v0.9.3-alpha -m "SYJ-HCM Phase 1.2a multi-tenant foundation"
git push origin v0.9.3-alpha
```

## 11. Release decision

Phase 1.1 remains the security-hardening release.

Phase 1.2a is the tenant-foundation release. It should not be marketed as a complete commercial SaaS/HCM release yet because customer onboarding, organization administration, billing/licensing, notifications, documents, policies, ATS, operations, payroll and production observability remain intentionally outside this build.

## 12. Key file / line references

These references point to the final Phase 1.2a source snapshot:

- `src/db/schema.ts:5-25` — organization root and tenant status model.
- `src/db/schema.ts:31-92` — tenant columns on departments/users/sessions/login rate limits.
- `src/db/schema.ts:104-224` — tenant columns/indexes on employees, leave, attendance and audit tables.
- `drizzle/0003_multi_tenant_foundation.sql:1-18` — organization creation and default backfill root.
- `drizzle/0003_multi_tenant_foundation.sql:51-188` — tenant-aware replacement table definitions.
- `drizzle/0003_multi_tenant_foundation.sql:189-278` — populated-row backfill and legacy-table retirement.
- `drizzle/0003_multi_tenant_foundation.sql:280-357` — tenant indexes and restored Phase 1.1 integrity triggers.
- `src/lib/session.ts:57-76` — organization-bound session creation.
- `src/lib/session.ts:130-181` — server-derived organization context from the authenticated session/user relationship.
- `src/lib/authorization.ts:7-26` — organization boundary helper and ownership checks.
- `src/lib/authorization.ts:43-63` — RBAC matrix with `same_organization` dimension.
- `src/lib/login-rate-limit.ts:16-106` — organization-aware rate-limit key and queries.
- `src/app/login/actions.ts:55-90` — pre-auth email lookup followed by persisted organization resolution and tenant-aware session/audit creation.
- `src/app/(app)/employees/actions.ts:20-35` — organization-scoped department and employee uniqueness validation.
- `src/app/(app)/leave/actions.ts:40-82` — tenant-scoped leave validation and insert.
- `src/app/(app)/attendance/actions.ts:35-72` — tenant-scoped clock-in reads/writes.
- `src/app/(app)/dashboard/page.tsx:83-110` — organization-scoped HR dashboard queries.
- `tests/tenant-isolation.test.ts:88-130` — cross-tenant negative read/mutation checks.
- `tests/tenant-migration.test.ts:38-88` — populated-schema migration and NOT NULL/backfill validation.

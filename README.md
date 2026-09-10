# SYJ-HCM

Sayanjali Human Capital Management — Core HR foundation with production security hardening and the Phase 1.2a multi-tenant foundation.

This repository contains real working software backed by SQLite through Drizzle ORM. There is no mocked tenant data and no placeholder tenant enforcement.

## Current release line

- Current development version: **0.9.3-alpha**
- Phase 1.1 security-hardening release: **v0.9.2-alpha**
- Phase 1.2a multi-tenant foundation: **v0.9.3-alpha** (proposed; tag after validation)

The v0.9.2-alpha tag is intentionally limited to the documentation/version correction and Phase 1.1 hardening that was already merged into `main`. The Phase 1.2a tenant model is a separate subsequent release.

## Phase 1 — Core HR

Implemented:

- Authentication with scrypt password hashing and DB-backed HMAC-signed sessions
- Seven-day absolute and 24-hour idle session policy
- DB-backed failed-login throttling
- Password rotation with previous-session revocation
- Sign-out-other-sessions
- Server-side role-based authorization for admin / HR / employee
- Employee CRUD and status management
- Employee self-service profile
- Leave application, approval, rejection and cancellation
- Leave overlap and balance validation
- Transaction-safe leave and attendance mutations
- Browser geolocation attendance with server-authoritative timestamps
- Attendance coordinate validation and database integrity guards
- HR/admin dashboard and employee-private dashboard
- Immutable audit records

## Phase 1.1 — Production security hardening

The merged hardening pass added:

- Persistent login throttling
- Failed-login and authorization-failure auditing
- Absolute + idle session expiry
- Session revocation on password change
- Explicit authorization helpers/matrix
- Transaction boundaries for authentication, employee, leave and attendance operations
- Transactional migration application
- Attendance coordinate and clock-order database guards
- Leave state-machine guard
- Immutable audit-log triggers
- CSP and production security headers
- Production HSTS
- Private/no-store authenticated responses
- Fail-closed production startup checks
- CI verification for locked install, typecheck, tests, production build and production dependency audit

The current repository contains **47 test cases defined in `tests/*.test.ts`**: the original Phase 1/1.1 coverage plus the new Phase 1.2a tenant-isolation and populated-schema migration tests. The repository itself does not store historical GitHub Actions logs, so a past test/build/audit result is not represented as a source-of-truth file here; validate the checkout locally and rely on the CI run attached to the pushed commit for release sign-off.

The CI workflow currently runs:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm audit --omit=dev --audit-level=high`

The deprecated interactive `next lint` command is intentionally not a CI step. The production build is the non-interactive Next.js validation gate.

## Phase 1.2a — Multi-tenant foundation

This pass adds the organization/tenant model only. It does **not** add organization settings, branding, billing, licensing, notifications, policies, import/export, password reset or email verification.

### Tenant root

An `organizations` table is now the tenant root:

- `id`
- `name`
- `slug`
- `status`
- `created_at`
- `updated_at`

Every existing tenant-scoped table now has a required `organization_id`:

- `departments`
- `users`
- `sessions`
- `login_rate_limits`
- `employees`
- `leave_types`
- `leave_balances`
- `leave_requests`
- `attendance_records`
- `audit_logs`

Existing rows are migrated into a single `org_default` organization. The migration copies populated tables into tenant-aware tables, verifies the organization backfill, preserves the existing foreign-key graph and reinstalls the Phase 1.1 integrity triggers before completing.

### Authentication tenant context

The browser cookie contains only the signed session identifier. It does **not** carry a client-trusted organization identifier.

After authentication, `getCurrentUser()` resolves `organizationId` from the database-backed session/user relationship. Every authenticated application query uses that organization context.

The login email lookup is intentionally the only pre-auth identity-resolution query that is not organization-filtered: there is no authenticated tenant context yet. Once the account is found, its persisted organization becomes the tenant context for rate limiting, auditing and session creation. Unknown-login attempts use the migration's default authentication organization namespace.

### Tenant isolation

Existing page queries and Server Actions have been updated to scope reads/writes by the authenticated user's `organizationId`. Cross-organization ID manipulation is covered by negative isolation tests for employees, leave requests, attendance, audit records, sessions and login-rate-limit records.

## Database driver

The project uses:

- Next.js 15.5.25
- React 18.3.1
- Drizzle ORM 0.45.2
- Node.js built-in `node:sqlite`
- `drizzle-orm/sqlite-proxy`
- Tailwind CSS
- Node's built-in `node:test`

No `better-sqlite3` or `sqlite3` dependency is used, and no Redis or other new infrastructure dependency was introduced for Phase 1.2a.

Node.js **22.5.0 or later** is required because the project uses `node:sqlite`.

## Database migrations

The checked-in migrations are:

- `0000_init.sql` — Phase 1 schema
- `0001_phase1_1_security.sql` — Phase 1.1 security constraints
- `0002_attendance_clock_order_insert_guard.sql` — Phase 1.1 clock-order follow-up
- `0003_multi_tenant_foundation.sql` — Phase 1.2a organization/tenant migration

Use the custom migration runner:

```bash
npm run db:migrate
```

`npm start` intentionally refuses to start with pending migrations.

## Development seed

```bash
ALLOW_DEV_SEED=true npm run db:seed
```

Seed data is development-only and belongs to the default organization. Production startup rejects `ALLOW_DEV_SEED=true`.

## Setup

```bash
npm ci
cp .env.example .env
# Set a unique random SESSION_SECRET (32+ characters)
npm run db:migrate
npm run build
npm start
```

## Testing

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

The test suite includes:

- password hashing/verification
- leave date and balance rules
- attendance constraints
- authorization negatives
- login rate limiting
- session policy
- geolocation validation
- security/database constraints
- concurrency invariants
- **tenant isolation negatives**
- **populated-schema tenant migration/backfill validation**

## Project structure

```text
src/
  app/
    login/                  Authentication and login Server Action
    (app)/                  Authenticated application routes
      dashboard/            Tenant-scoped workforce dashboard
      employees/            Tenant-scoped employee CRUD
      leave/                Tenant-scoped leave workflows
      attendance/           Tenant-scoped attendance workflows
      profile/              Tenant-scoped employee self-service
  db/
    schema.ts               Organization + tenant-aware Drizzle schema
    client.ts               node:sqlite + Drizzle sqlite-proxy
  lib/
    auth.ts                 Authentication/authorization boundaries
    authorization.ts        Role + organization authorization rules
    tenant.ts               Server-derived tenant context constants/types
    session.ts              DB-backed session lifecycle
    audit.ts                Tenant-scoped audit writer
    login-rate-limit.ts     Tenant-aware failed-login throttling
    leave-rules.ts          Tenant-scoped leave rules
  middleware.ts              UX redirect/cache controls only

drizzle/
  0000_init.sql
  0001_phase1_1_security.sql
  0002_attendance_clock_order_insert_guard.sql
  0003_multi_tenant_foundation.sql

scripts/
  migrate.ts                Transactional migration runner
  seed.ts                   Development-only seed
  start.ts                  Production startup validation
  verify-phase1-1.sh        Phase 1.1 local verification helper

tests/
  tenant-isolation.test.ts  Cross-tenant read/mutation negatives
  tenant-migration.test.ts Populated legacy-schema migration test
```

## Scope deliberately left for later

Not part of Phase 1.2a:

- organization settings
- organization branding
- subscription/billing
- commercial licensing
- holiday calendars
- attendance policy configuration
- leave policy configuration
- employee import/export
- notifications
- password reset
- email verification
- document management
- backups/restore automation
- monitoring/observability platform
- recruiting/ATS
- onboarding
- expenses/helpdesk/performance/OKRs
- payroll/statutory engine
- analytics

These must be built on top of the tenant foundation rather than alongside it.

## Known current limitations

- The current login identity remains globally unique by email. This is deliberate for Phase 1.2a because the current login flow resolves the account before authentication and does not accept a client-trusted organization selector. A future organization-aware identity/login flow can be introduced as a separate productization step.
- Organization creation and customer onboarding UI are not included in this pass.
- There is no subscription, licence-key or billing system yet.
- Leave requests spanning calendar years still follow the existing Phase 1 calendar-year balance behavior.
- Attendance still derives "Absent Today" from active employees minus present/on-leave counts; no end-of-day absence job exists yet.

## Release tags

For the already-merged Phase 1.1 hardening release:

```bash
git tag -a v0.9.2-alpha -m "SYJ-HCM Phase 1.1 production hardening"
git push origin v0.9.2-alpha
```

For the separate Phase 1.2a tenant foundation after validation:

```bash
git tag -a v0.9.3-alpha -m "SYJ-HCM Phase 1.2a multi-tenant foundation"
git push origin v0.9.3-alpha
```

Do not tag the tenant foundation as `v0.9.2-alpha`; that release name is reserved for the already-merged Phase 1.1 hardening/documentation correction.

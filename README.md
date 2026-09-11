# SYJ-HCM

Sayanjali Human Capital Management — secure multi-tenant HCM foundation evolving into a SaaS-ready product platform.

## Current release

- **Current development release:** `v0.9.5-alpha`
- **Phase:** `1.2c — Productization / SaaS Foundation`
- **Previous release:** `v0.9.4-alpha — Phase 1.2b Organization / Tenant Management`
- **Baseline commit:** `d4f7a944fce83864894fe37ab2534e0088b97c25`

The repository uses real SQLite-backed application state. Tenant and platform authorization are enforced on the server; browser state is never an authority for organization ownership or platform privilege.

## Architecture

```text
PLATFORM
└── platform_administrators
      │
      └── authenticated user
            │
            └── ORGANIZATION
                  ├── admin
                  ├── hr
                  └── employee
                        │
                        ├── Employees
                        ├── Leave
                        └── Attendance
```

Platform administration is a separate server-side capability. An organization `admin` is **not** automatically a platform administrator.

Technology remains intentionally lightweight:

- Next.js 15.5.25
- React 18.3.1
- TypeScript
- Drizzle ORM 0.45.2
- SQLite via Node.js built-in `node:sqlite`
- `drizzle-orm/sqlite-proxy`
- Tailwind CSS
- Node built-in test runner
- Node.js 22.5.0+

No `better-sqlite3`, `sqlite3`, Redis, external database, native SQLite addon, microservice, or Kubernetes dependency is introduced.

## Phase 1 — Core HR

Implemented:

- scrypt password hashing
- HMAC-signed DB-backed sessions
- seven-day absolute and 24-hour idle session policy
- persistent login throttling
- password rotation and session revocation
- server-side RBAC for `admin`, `hr`, and `employee`
- employee CRUD and status management
- employee self-service profile
- leave application, approval, rejection and cancellation
- leave overlap and balance validation
- transaction-safe leave and attendance mutations
- browser geolocation attendance with server-authoritative timestamps
- database attendance integrity guards
- immutable tenant audit logs

## Phase 1.1 — Production security hardening

Implemented:

- persistent failed-login throttling and audit events
- authorization-failure auditing
- absolute + idle session expiration
- password-change session revocation
- explicit authorization matrix
- transaction boundaries around security-sensitive mutations
- transactional migration runner
- attendance coordinate/clock-order database guards
- leave state-machine guard
- immutable audit triggers
- CSP, security headers and HSTS in production
- private/no-store authenticated responses
- fail-closed production startup validation
- CI locked-install, typecheck, test, build and production dependency audit gates

## Phase 1.2a — Multi-tenant foundation

Implemented:

- `organizations` tenant root
- required `organization_id` on tenant-owned tables
- populated-data migration/backfill
- tenant-scoped employees, users, sessions, leave, attendance and audit records
- authenticated server-derived organization context
- cross-tenant negative tests
- organization slug uniqueness
- tenant-safe foreign keys and indexes

## Phase 1.2b — Organization / Tenant Management

Implemented:

- organization overview and identity administration
- server-side name/slug validation
- organization member listing
- member activation/deactivation
- member role management
- employee ↔ user association within one tenant
- active-administrator lockout protection
- tenant-scoped session revocation on deactivation
- organization-aware navigation
- organization/member audit events
- cross-tenant read, mutation and enumeration protections

## Phase 1.2c — Productization / SaaS Foundation

Implemented in this release:

### Platform administration

- separate `platform_administrators` capability table
- server-side platform authorization
- platform organization inventory
- platform-level lifecycle controls
- platform audit visibility
- controlled server-side bootstrap command for granting platform capability

Bootstrap an existing account from a trusted server shell only:

```bash
npm run platform:grant-admin -- admin@example.com
```

This does not convert the user's organization role; the user remains `admin`, `hr`, or `employee` for tenant operations.

### Organization provisioning

A platform administrator can atomically create:

1. organization
2. organization defaults
3. initial administrator account
4. platform audit events

Provisioning validates identity, slug uniqueness, email uniqueness and password length before entering a transaction. A deliberate failure after account creation rolls back the organization, configuration and user records together.

No email invitation or verification system is claimed to exist.

### Organization lifecycle

Supported states:

- `active`
- `suspended`

Suspension:

- blocks normal authenticated tenant access
- revokes tenant sessions
- preserves all tenant data
- remains reversible by a platform administrator
- does not delete organizations or tenant records

A platform administrator can still access `/platform` even when the platform administrator's own organization is suspended. The platform control intentionally lives outside the authenticated tenant application layout.

### Tenant configuration

Each organization now receives an `organization_settings` row with validated, typed defaults for:

- timezone
- locale
- date format
- week start day

Configuration is organization-owned, server-scoped and audit logged. It is intentionally small so future HR modules can build their own typed policies without introducing an arbitrary JSON settings bucket.

### Audit model

Two immutable audit boundaries now exist:

- `audit_logs` — tenant-scoped operational/security events
- `platform_audit_logs` — platform-scoped administrative events

Platform audit does not weaken or overload the tenant audit table.

## Security boundary

The server derives tenant context from the authenticated DB-backed session. Client-provided organization IDs are only target selectors for deliberately platform-wide operations; they are never accepted as proof of authority.

Normal organization actions remain tenant-scoped. Platform actions require membership in `platform_administrators` and are independently authorized server-side.

Suspended organizations cannot use the normal `(app)` route or Server Action boundary. Platform administrators retain access to platform recovery controls.

## Database migrations

```text
0000_init.sql                              Phase 1 schema
0001_phase1_1_security.sql                 Phase 1.1 security constraints
0002_attendance_clock_order_insert_guard.sql Phase 1.1 follow-up guard
0003_multi_tenant_foundation.sql           Phase 1.2a tenant foundation
0004_phase1_2c_productization.sql          Phase 1.2c SaaS foundation
```

The new migration is additive. Historical migrations are unchanged.

The migration runner applies each migration inside `BEGIN IMMEDIATE` / `COMMIT` and records it in `__migrations`.

## Setup

```bash
npm ci
cp .env.example .env
# Set a unique random SESSION_SECRET with at least 32 characters.
npm run db:migrate
npm run build
npm start
```

For development seed data only:

```bash
ALLOW_DEV_SEED=true npm run db:seed
```

Production startup rejects `ALLOW_DEV_SEED=true`.

## Validation

The Phase 1.2c build environment could not complete `npm ci` because outbound package installation was unavailable and the uploaded repository did not contain `node_modules`. Therefore dependency-dependent commands were **not fabricated as PASS**.

Completed offline validation:

- fresh migration: **PASS**
- populated v0.9.4 migration/backfill: **PASS**
- migration schema/trigger checks: **PASS**
- source/repository consistency review: **PASS**

Required local validation remains:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Also manually exercise platform provisioning, suspension/recovery and tenant configuration after migration.

## Known limitations / deliberate deferrals

- Email invitations, verification, password reset, MFA, SSO and OAuth are not implemented.
- Initial administrator credentials are supplied through the platform provisioning form; the operator must transfer them through a secure channel. No email delivery is claimed.
- Platform administrator bootstrap is intentionally a trusted server-shell operation rather than a browser workflow.
- The current login identity remains globally unique by email because the existing authentication flow resolves identity before tenant context exists.
- Organization deletion is intentionally not implemented.
- Billing, subscriptions, licensing and commercial provisioning are not implemented.
- Attendance and leave policies remain existing Phase 1 functionality; this phase establishes the configuration boundary rather than a full policy engine.
- Advanced observability, backups/restore automation and external infrastructure remain future work.

## Roadmap

```text
Phase 1     Core HR                              COMPLETE
Phase 1.1   Production Security Hardening       COMPLETE
Phase 1.2a  Multi-Tenant Foundation              COMPLETE
Phase 1.2b  Organization / Tenant Management     COMPLETE
Phase 1.2c  Productization / SaaS Foundation     CURRENT — v0.9.5-alpha
Phase 2     Recruiting / ATS                     NEXT
Phase 3     HR Operations Expansion
Phase 4     Payroll + Analytics
```

Phase 2 should build Recruiting/ATS on this tenant, organization, authorization, audit, lifecycle and configuration foundation. It should not bypass these boundaries.

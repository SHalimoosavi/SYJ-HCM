# SYJ-HCM — Phase 1.1 Production Readiness & Security Hardening

## Scope

Repository baseline: `main` at `030168a6b5c2952933e371ad31e6878fb2391921`.

This hardening pass does **not** add Recruiting/ATS/Onboarding or any other Phase 2 feature.
The existing `node:sqlite` + `drizzle-orm/sqlite-proxy` architecture is preserved and no native binary dependency is introduced.

## 1. Authentication

### Root cause / baseline

- `src/lib/session.ts` previously had only a seven-day absolute session expiry and no DB-backed idle timestamp.
- The cookie already used `httpOnly`, `sameSite=lax`, `secure` in production, and a path of `/`.
- `src/app/login/actions.ts` had generic credential errors but no persistent failed-login throttling.
- `src/app/(app)/profile/actions.ts` changed the password without revoking existing sessions.

### Fix

- Added `sessions.last_active_at`.
- Added seven-day absolute + 24-hour idle session policy.
- Added five-minute DB touch interval.
- Added DB-backed login throttling in `login_rate_limits` (15-minute window, five failures, 15-minute lockout).
- Login failures are audited using an HMAC-derived identifier rather than storing raw IP/email in the audit entity id.
- Password changes atomically revoke previous sessions, create a fresh session, update the password, and write the audit event.
- Added “Sign out other sessions” self-service action.
- Session secret minimum strengthened to 32 characters.

### Behavior change

Repeated failed logins can now be throttled; idle sessions older than 24 hours require re-authentication; password changes sign out prior sessions. These are intentional security changes.

## 2. RBAC / authorization

### Root cause / baseline

- Server-side role enforcement already existed through `requireUser`, `requireRole`, `requireUserForAction`, and `requireRoleForAction`.
- Leave cancellation had an inline ownership/HR check.
- The employee dashboard exposed organization-wide workforce metrics and recent audit activity to ordinary employees.

### Fix

- Added explicit authorization helpers and an authorization matrix in `src/lib/authorization.ts`.
- Leave ownership checks now use the shared helper.
- Added negative authorization tests for employee/HR/admin role and ownership boundaries.
- Employee dashboard now shows personal HR information only; organization-wide metrics and activity remain HR/admin-only.
- Authorization failures are audited for both page and Server Action boundaries.

### Behavior change

Employees no longer see organization-wide workforce counts, upcoming organization leave, or recent audit activity on the dashboard. This is intentional privacy/RBAC hardening.

## 3. Database / migrations

### Root cause / baseline

- The custom migration runner tracked applied files but executed a migration and its ledger insert without a transaction.
- Several business operations performed multiple related writes as separate awaited statements.

### Fix

- Migration execution and `__migrations` ledger insertion are now wrapped in `BEGIN IMMEDIATE` / `COMMIT`, with rollback on failure.
- Added a synchronous transaction helper around the existing `DatabaseSync` connection. The callback is deliberately synchronous so another request cannot interleave statements into the transaction.
- Employee creation, employee update/status changes, leave operations, attendance mutations, login session creation, and password rotation now use atomic transaction boundaries where correctness matters.
- Added DB-level state/coordinate/audit integrity triggers.

### Validation

The actual migration runner was transpiled and executed against a fresh temporary SQLite database twice. First run applied `0000_init.sql` and `0001_phase1_1_security.sql`; second run skipped both as already applied. The migration ledger contained both migrations after the second run.

## 4. Attendance / geolocation

### Root cause / baseline

- The server already generated authoritative timestamps and enforced one attendance row per employee/day through a unique index.
- Latitude/longitude were converted with `Number()` but had no finite/range validation.
- The clock-in read/update/insert flow could race with another request.
- The personal attendance query selected complete records even though coordinates were not rendered.

### Fix

- Added server-side coordinate validation: latitude `[-90,90]`, longitude `[-180,180]`, finite numbers, and pair completeness.
- Added DB triggers enforcing coordinate bounds and coordinate-pair integrity.
- Clock-in/out updates are conditional and transactional; concurrent duplicate inserts return the existing “already clocked in” behavior instead of surfacing a raw constraint error.
- Personal attendance history selects only date/time/status fields; geolocation is not exposed to the UI.
- HR/admin organization attendance view still excludes coordinates.

### Behavior change

Malformed or partial coordinates are rejected instead of being silently stored as `null`/invalid numbers. This is intentional validation hardening.

## 5. Leave

### Root cause / baseline

The previous approval flow separately updated the leave request and then incremented the balance. Two approvals could observe the same remaining balance, and a failure between the two writes could leave inconsistent state.

### Fix

- Leave apply, cancel, approve, and reject paths now use short synchronous SQLite transactions.
- Approval performs the balance decrement with an atomic conditional update: `allocated - used >= requested_days`.
- Approval re-checks date overlap inside the same transaction.
- Approval/cancellation/rejection updates require `status = 'pending'`.
- Added DB trigger enforcing the allowed state machine: `pending -> approved|rejected|cancelled`; terminal states cannot be reversed.
- Added concurrency invariant test showing two one-day balance decrements against one remaining day allow exactly one update.

### Behavior change

An approval that races with cancellation or another approval now deterministically loses if its request is no longer pending or its balance is no longer sufficient. This prevents overspending and invalid state transitions.

## 6. Audit logging

### Root cause / baseline

The previous audit writer was append-only by convention, but SQLite itself did not prevent direct UPDATE/DELETE operations. Login failures and authorization failures were not consistently logged.

### Fix

- Added synchronous audit insertion for atomic business transactions.
- Added `login_failed`, `authorization_failed`, `sessions_revoked`, and existing authentication/business events to the audit stream.
- Added SQLite triggers rejecting UPDATE and DELETE against `audit_logs`.
- No application UPDATE/DELETE path for audit logs exists.

### Validation

A real SQLite test confirmed direct UPDATE and DELETE attempts against `audit_logs` fail with `Audit logs are immutable`.

## 7. Security baseline

### Root cause / baseline

- `next.config.mjs` was empty.
- Middleware only performed the documented cookie-presence UX redirect.
- Production startup did not validate configuration or migration completeness.

### Fix

Added:

- Content-Security-Policy
- X-Content-Type-Options
- X-Frame-Options
- Referrer-Policy
- Permissions-Policy with geolocation limited to the application origin
- Cross-Origin-Opener-Policy
- HSTS in production
- `Cache-Control: private, no-store` for application responses
- Production startup validation for `SESSION_SECRET`, development seed mode, database existence, migration completeness, and required tables.

The existing middleware remains intentionally non-authoritative for authentication; database-backed authorization remains in the application layer.

### Validation

The startup validator was executed with no `SESSION_SECRET` and correctly exited with status 1 before attempting to start Next.js. It was also executed with a valid-length secret and a missing database and correctly failed closed with a migration/setup message.

## 8. Deployment / CI

### Fix

- `npm start` now uses `scripts/start.ts` for fail-fast production checks before launching `next start`.
- Added `.github/workflows/ci.yml` with:
  - locked dependency installation
  - typecheck
  - lint
  - tests
  - production build
  - `npm audit --omit=dev --audit-level=high`
- Added `scripts/verify-phase1-1.sh` for the same local verification sequence.
- `.env.example` now defaults development seed mode to false and documents the stronger secret requirement.

## 9. Final verification status

### Actually executed in the build workspace

- SQLite migration SQL syntax and trigger installation: **passed**.
- Migration runner behavior: **passed** on a fresh temporary DB and a second idempotent run.
- TypeScript/TSX syntax parse across 55 files using the TypeScript compiler API: **passed; no syntax diagnostics**.
- Session policy checks: **passed**.
- Authorization helper checks: **passed**.
- Production startup fail-fast checks: **passed** for missing secret and missing database cases.
- `node --check next.config.mjs`: **passed**.

### Not honestly claimable from this workspace

The complete `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm audit --omit=dev` suite could not be executed here because this build workspace has no network access and the source bundle available to the workspace does not contain the repository's `package-lock.json`/installed dependency tree. The user's existing Termux clone does contain the known-good lockfile and should be used for the final real dependency validation.

Do **not** mark Phase 1.1 signed off until the final verification script passes in the user's clone.

## Changed / added files

- `.env.example`
- `.github/workflows/ci.yml`
- `README.md`
- `next.config.mjs`
- `package.json`
- `drizzle/0001_phase1_1_security.sql`
- `scripts/migrate.ts`
- `scripts/start.ts`
- `scripts/verify-phase1-1.sh`
- `src/db/client.ts`
- `src/db/schema.ts`
- `src/lib/audit.ts`
- `src/lib/auth.ts`
- `src/lib/authorization.ts`
- `src/lib/geolocation.ts`
- `src/lib/login-rate-limit.ts`
- `src/lib/session-policy.ts`
- `src/lib/session.ts`
- `src/middleware.ts`
- `src/app/login/actions.ts`
- `src/app/(app)/attendance/actions.ts`
- `src/app/(app)/attendance/page.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/employees/actions.ts`
- `src/app/(app)/leave/actions.ts`
- `src/app/(app)/profile/actions.ts`
- `src/app/(app)/profile/page.tsx`
- `src/app/(app)/profile/session-management-form.tsx`
- `tests/helpers/setup-test-db.ts`
- `tests/authorization.test.ts`
- `tests/concurrency-invariants.test.ts`
- `tests/geolocation.test.ts`
- `tests/login-rate-limit.test.ts`
- `tests/security-constraints.test.ts`
- `tests/session-policy.test.ts`

## Recommended commits

1. `feat: harden authentication and session lifecycle`
2. `feat: harden authorization attendance leave and audit integrity`
3. `feat: add production security headers startup checks and CI`

For a single squashed release commit, use:

`feat: harden Phase 1 foundation for production`

## Recommended tag

`v0.9.2-alpha`

Reason: this is a direct hardening release after `v0.9.1-alpha`, with no Phase 2 scope included.

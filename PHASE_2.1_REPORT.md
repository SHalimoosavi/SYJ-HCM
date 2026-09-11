# SYJ-HCM v0.10.0-alpha — Phase 2.1 Recruitment Foundation Report

## 1. Scope
Phase 2.1 establishes the tenant-scoped Recruitment / Applicant Tracking System foundation on top of the existing HCM and SaaS platform architecture.

## 2. Delivered
- Job requisitions with controlled lifecycle: draft, open, on_hold, closed, cancelled.
- Requisition code, department, location, employment type, description, requirements, skills, salary range, currency, explicit validated openings count, recruiter and hiring manager assignments, dates and creator metadata. A separate opening table is intentionally deferred until per-opening identity is required.
- Separate candidate identity model so one candidate can hold multiple applications.
- Candidate create/update/profile and tenant-scoped duplicate email protection.
- Separate application model linking candidates to requisitions.
- Application lifecycle: applied, screening, shortlisted, interview, evaluation, offer, hired, rejected, withdrawn, archived.
- Database partial unique index preventing duplicate active applications for the same candidate/job while allowing a later reapplication after rejected/withdrawn/archived states.
- Application history recording every status transition with actor, server timestamp and reason.
- Recruitment audit events through the existing immutable tenant audit log.
- Tenant-safe composite foreign keys for department, employee/user assignment, candidate, requisition and application history relationships.
- Server-side RBAC restricted to existing `admin` and `hr` roles; `employee` receives no recruitment administration capability.
- Existing platform administrator capability remains separate from tenant RBAC.
- Suspended organizations inherit existing server-side action/page enforcement and cannot perform recruitment operations.
- Recruitment dashboard, jobs, candidates and applications pages plus working create/edit/detail/lifecycle flows.
- Basic tenant-scoped search/filtering for jobs, candidates and applications.

## 3. Database
Migration: `drizzle/0005_phase2_1_recruitment_foundation.sql`

New tables:
- `job_requisitions`
- `candidates`
- `applications`
- `application_history`

Supporting composite unique indexes were added to existing `users`, `employees`, and `departments` to allow tenant-aware composite foreign keys.

## 4. Security
All recruitment Server Actions resolve organization context from the authenticated database-backed session. Browser-provided organization IDs are not used as authority. Resource lookups and mutations include organization scope. Recruiter, hiring-manager, department, candidate and requisition references are validated inside the actor's tenant.

## 5. Transactions
Job creation, candidate creation, application creation and application status transitions use SQLite transactions where multiple state/history/audit records must change together. Application status changes update the application, history and audit event atomically.

## 6. Validation
Server-side validation covers controlled enums, requisition code, names, email, openings, salary ranges, dates, tenant ownership and application lifecycle transitions. Database checks and foreign keys enforce critical invariants.

## 7. Deliberate Phase 2.1 boundaries
Not implemented in this phase:
- Resume/file uploads or object storage
- Configurable recruitment stages
- Interview scheduling/scorecards
- Offer generation/acceptance workflows
- Notifications
- AI candidate scoring or screening
- Billing/subscriptions
- Payroll
- External search infrastructure

These belong to later phases and are not represented as fake functionality.

## 8. Validation target
Before release, run:
- `npm ci`
- `npm run db:migrate`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm audit --omit=dev --audit-level=high`
- `git diff --check`

Also validate fresh/populated migrations and recruitment tenant/RBAC/security invariants.

## 9. Next phase
Phase 2.2 — Candidate Pipeline: configurable stages, screening/shortlisting, rejection/withdrawal reasons, pipeline views, stage movement and richer candidate history.

## 10. Test inventory
The dedicated Phase 2.1 suite contains 10 tests covering tenant-aware foreign keys, job lifecycle rules, candidate reuse, active application duplicate protection, application lifecycle rules, history tenant binding, cross-tenant reads, database checks, transaction rollback, and tenant-scoped candidate duplicate protection.

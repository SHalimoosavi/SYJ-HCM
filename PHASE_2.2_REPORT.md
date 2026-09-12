# SYJ-HCM v0.11.0-alpha — Phase 2.2 Report

## 1. Objective

Phase 2.2 turns the Phase 2.1 ATS foundation into a controlled recruitment workflow and interview management subsystem while preserving the existing authentication, RBAC, tenant isolation, audit infrastructure, SQLite adapter, and organization lifecycle model.

## 2. Architecture

The implementation uses Next.js Server Components and Server Actions, the existing authenticated server-side tenant context, Drizzle/SQLite for normal reads, and synchronous `node:sqlite` transactions for multi-record recruitment mutations.

No new infrastructure or native database dependency is introduced.

## 3. Schema

Migration: `drizzle/0006_phase2_2_recruitment_workflow_interviews.sql`

New tables:

- `recruitment_stages`
- `interview_rounds`
- `interviews`
- `interview_participants`
- `interview_feedback`
- `interview_feedback_corrections`
- `interview_decisions`
- `candidate_notes`
- `candidate_activities`

Existing `application_history` receives `previous_stage`, `new_stage`, and `note` columns so Phase 2.1 history remains the single application transition history rather than introducing a redundant history table.

Existing Phase 2.1 records are backfilled into the business activity stream during the additive migration.

## 4. Workflow model

The existing application status machine remains deterministic:

`applied → screening → shortlisted → interview → evaluation → offer → hired`

with controlled rejection/withdrawal exits and archival of terminal rejected/withdrawn records.

Phase 2.2 adds tenant-owned lifecycle stage configuration. Stable status keys preserve application integrity while HR/admin users can configure stage display names, ordering, and active state. The system intentionally does not become an arbitrary executable workflow engine.

Every application transition is validated server-side and records application history, business activity, and audit data in one SQLite transaction.

## 5. Interview model

An application can contain multiple `interview_rounds`, and each round can contain an `interviews` session.

Sessions contain:

- application and round
- controlled interview type
- title
- status lifecycle
- start/end
- IANA timezone
- location/meeting details
- organizer
- creation/update metadata

## 6. Interviewer / panel model

`interview_participants` is a proper relationship table rather than a comma-separated field.

Each participant is tenant-bound to the interview and user. The database prevents duplicate membership. Server-side validation verifies active same-organization users.

Assignment does not grant global recruitment permissions.

## 7. Scheduling

Interview forms accept a local wall-clock datetime and IANA timezone. The server converts it to canonical UTC and preserves the intended timezone for display.

Invalid dates, nonexistent wall-clock times, and end-before-start schedules are rejected.

Active interviewer conflicts are detected server-side. Critical scheduling/participant operations use `BEGIN IMMEDIATE` through the existing `withSqliteTransactionSync` mechanism.

## 8. Interview lifecycle

Controlled statuses:

- scheduled
- confirmed
- completed
- cancelled
- rescheduled
- no_show

Completed, cancelled, and no-show sessions cannot be silently rescheduled or edited through normal lifecycle operations.

## 9. Feedback

Feedback is linked to an interview and submitting interviewer, with:

- score 1–5
- controlled recommendation
- strengths
- concerns
- optional notes
- server timestamp

Only an assigned interviewer can submit their own feedback. Submitted feedback is database-immutable.

Corrections are append-only records containing previous values, new values, correcting actor, reason, and timestamp.

## 10. Decisions

Interview decisions are restricted to:

- `advance`
- `hold`
- `reject`

An advance decision moves an eligible interview-stage application to `evaluation`. A reject decision moves an eligible application to `rejected`. Hold records the decision without forcing a lifecycle transition. All are audited and transactionally coupled with required application history/activity.

## 11. Candidate activity

`candidate_activities` is the business timeline. It is intentionally separate from the existing immutable security/compliance `audit_logs` stream.

The timeline records real events such as candidate/application creation, stage movement, interview operations, panel changes, feedback, decisions, notes, rejection, withdrawal, and archive events.

Timeline queries are tenant scoped and bounded.

## 12. Notes

Recruitment notes are tenant-scoped plain text records attached to a candidate and optionally an application. Server-side validation limits content length. Notes are never rendered as raw HTML. HR/admin only access is enforced at the route and action boundary.

## 13. RBAC

Existing organization roles remain `admin`, `hr`, and `employee`.

- Admin: full recruitment management.
- HR: recruitment management.
- Employee: no general ATS management.
- Assigned employee interviewer: access to permitted interview information and their own feedback submission only.

Recruiter/hiring-manager assignments do not create authorization roles.

## 14. Tenant isolation

Every Phase 2.2 tenant table includes `organization_id` and relevant relationships use `(organization_id, id)` composite foreign keys.

All reads and mutations are constrained to the authenticated organization. Cross-tenant candidate, application, interview, participant, feedback, note, activity, and workflow references fail safely.

Suspended organizations are blocked at the existing authenticated Server Action boundary and by Phase 2.2 mutation guards.

## 15. Audit

Security/compliance events continue to use immutable `audit_logs` with existing protection. Phase 2.2 additionally emits business activity records for recruitment workflow history.

Audited events include stage changes, interview creation/rescheduling/cancellation/status changes, interviewer changes, feedback submission/correction, decisions, and protected notes.

## 16. Transaction and concurrency safety

Multi-record interview creation occurs in one SQLite transaction. Participant assignment and scheduling conflict checks occur under the same write serialization mechanism. Application transitions and their history/activity/audit records are also transactional.

Database uniqueness constraints protect duplicate panel membership, duplicate feedback, duplicate decisions, tenant-scoped identifiers, and workflow stage uniqueness.

## 17. UI routes

- `/recruitment`
- `/recruitment/jobs`
- `/recruitment/jobs/new`
- `/recruitment/jobs/[id]`
- `/recruitment/candidates`
- `/recruitment/candidates/new`
- `/recruitment/candidates/[id]`
- `/recruitment/applications`
- `/recruitment/applications/new`
- `/recruitment/applications/[id]`
- `/recruitment/interviews`
- `/recruitment/interviews/new`
- `/recruitment/interviews/[id]`
- `/recruitment/stages`

## 18. Dashboard

The recruitment dashboard uses real tenant data for:

- applications awaiting screening
- shortlisted applications
- upcoming interviews
- feedback-needed interviews
- active workflow stages
- applications by stage
- recently updated applications

No hard-coded production metrics are used.

## 19. Testing

Dedicated Phase 2.2 tests cover workflow transitions, stage history, tenant isolation, stage configuration, timezone conversion, interview creation, panel membership, duplicate/overlap protection, lifecycle rules, feedback authorization/validation/immutability, decisions, notes, activity relationships, and transaction rollback.

The existing Phase 1 through Phase 2.1 suite remains part of the same `npm test` command.

## 20. Validation performed

The following repository-local validation was executed during this build:

- fresh database application of migrations `0000` through `0006`: PASS
- populated v0.10.0-style database migration to `0006`: PASS
- `PRAGMA foreign_key_check`: 0 violations on fresh and populated migration validation
- Phase 2.2 business-runtime smoke test using Node `node:sqlite`: PASS
- TypeScript/TSX parser validation of all 93 source/test files: PASS
- placeholder/debug scan: PASS
- whitespace validation: PASS
- `npm audit --package-lock-only --omit=dev --audit-level=high --offline`: 0 vulnerabilities
- dependency comparison against the v0.10.0 baseline: no dependency or devDependency changes

The full dependency installation could not be completed in this build sandbox: `npm ci` was attempted but the sandbox's package-network access timed out. Consequently, the repository-level `npm test`, `npm run typecheck`, and `npm run build` commands could not be truthfully reported as passed here. A global TypeScript compiler was used after the implementation was corrected; it no longer reported project syntax errors but could not resolve the repository's installed type-definition packages because dependencies were not installed. These commands must be run in the target repository environment before release.

## 21. Migration testing

The migration is additive and leaves migrations `0000` through `0005` untouched. It supports fresh and populated databases and is safe to rerun because the repository migration ledger records `0006` after successful application.

## 22. Documentation

`README.md` now contains exact clone, install, environment, migration, development, production, test, typecheck, audit, platform bootstrap, recruitment setup, troubleshooting, deployment, security, and limitation instructions.

## 23. Known limitations

- No external calendar synchronization.
- No email/SMS/WhatsApp notification infrastructure.
- No resume/CV/document storage.
- No public careers portal or candidate self-service.
- No offer management.
- No advanced analytics engine.
- No AI hiring or candidate scoring.
- Workflow configuration is intentionally limited to stable ATS lifecycle statuses rather than arbitrary executable workflows.

## 24. Phase 2.3 recommendation

Build secure candidate document/resume management using metadata in SQLite and a storage abstraction for binary objects. Include file validation, size limits, secure access, tenant isolation, document audit, and a malware-scanning integration boundary without storing arbitrary files inside SQLite.

## 25. Release

Version: `0.11.0-alpha`

Release artifact:

`SYJ-HCM-v0.11.0-alpha-Phase-2.2-Recruitment-Workflow-Interview-Management-Complete.zip`

Remote Git operations are intentionally excluded from the Phase 2.2 build process.

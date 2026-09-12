# SYJ-HCM

**SAYANJALI NEXUS — Human Capital Management + Applicant Tracking System**

Current development release: **v0.12.0-alpha**
Current phase: **Phase 2.3 — Candidate Documents & Resume Management**

SYJ-HCM is a multi-tenant HCM/ATS application built around a deliberately lightweight production architecture: Next.js, TypeScript, Server Actions, Drizzle ORM, SQLite, and Node.js built-in `node:sqlite`.

## 1. Architecture

```text
Next.js 15
  ├─ Server Components
  ├─ Server Actions
  └─ React UI
        │
        ▼
Authentication / Sessions / RBAC
        │
        ▼
Authenticated organization context
        │
        ├─ Core HR
        ├─ Leave
        ├─ Attendance
        ├─ Organization / Platform administration
        └─ Recruitment / ATS
              ├─ Jobs
              ├─ Candidates
              ├─ Applications
              ├─ Workflow stages
              ├─ Interviews / rounds / panels
              ├─ Feedback / corrections
              ├─ Decisions
              ├─ Notes
              ├─ Candidate activity timeline
              └─ Candidate documents / resume management
        │
        ▼
Drizzle ORM / sqlite-proxy
        │
        ▼
Node.js built-in node:sqlite
        │
        ▼
SQLite
```

No `better-sqlite3`, `sqlite3`, Redis, Kafka, RabbitMQ, PostgreSQL, microservices, Kubernetes, or external search infrastructure is required.

## 2. Requirements

- Node.js **22.5.0 or newer**. CI currently uses Node 24.18.0.
- npm compatible with the installed Node.js release.
- Linux, macOS, Windows, or a compatible Node environment.
- Termux on Android can be used for local development when a supported Node.js installation is available.
- A writable directory for the SQLite database.

## 3. Clone and install

```bash
git clone https://github.com/SHalimoosavi/SYJ-HCM.git
cd SYJ-HCM
npm ci
```

## 4. Environment configuration

Create the local environment file:

```bash
cp .env.example .env
```

`.env.example` contains safe placeholders only. Never commit `.env` or real credentials.

### Variables

`DATABASE_PATH`

Path to the SQLite database. The default is:

```text
./data/syj-hcm.db
```

`SESSION_SECRET`

A unique random secret used to sign session cookies. It must be at least 32 characters. Generate one with:

```bash
openssl rand -hex 32
```

`ALLOW_DEV_SEED`

Must be `false` for normal operation and production. The development-only seed command refuses to run unless explicitly set to `true`.

`DOCUMENT_STORAGE_PATH`

Private filesystem root for candidate documents. The default is `./data/storage`. It must not point inside a public/static asset directory.

`DOCUMENT_SCANNER_MODE`

Scanner integration mode. The bundled implementation uses `unavailable` and never claims malware-free status without a real scanner.

Example safe `.env`:

```dotenv
DATABASE_PATH=./data/syj-hcm.db
SESSION_SECRET=replace-with-a-long-random-value-generated-for-this-environment
ALLOW_DEV_SEED=false
DOCUMENT_STORAGE_PATH=./data/storage
DOCUMENT_SCANNER_MODE=unavailable
```

## 5. Database setup

SYJ-HCM stores its SQLite database at `DATABASE_PATH`. The application uses an explicit migration ledger named `__migrations`.

Run migrations:

```bash
npm run db:migrate
```

The migration runner applies each SQL file once inside a SQLite transaction. Running the command again safely skips migrations already recorded in `__migrations`.

Current migration sequence:

```text
0000_init.sql
0001_phase1_1_security.sql
0002_attendance_clock_order_insert_guard.sql
0003_multi_tenant_foundation.sql
0004_phase1_2c_productization.sql
0005_phase2_1_recruitment_foundation.sql
0006_phase2_2_recruitment_workflow_interviews.sql
0007_phase2_3_candidate_documents.sql
```

Historical migrations are never rewritten.

## 6. Development startup

After dependencies and migrations are installed:

```bash
npm run dev
```

The normal development server is started by Next.js.

## 7. Production build and startup

Build:

```bash
npm run build
```

Before production startup, migrations must be current:

```bash
npm run db:migrate
```

Start:

```bash
npm start
```

Production startup performs fail-closed checks for the session secret, migration ledger, pending migrations, organization configuration, and required schema tables before starting Next.js.

## 8. Verification commands

Typecheck:

```bash
npm run typecheck
```

Tests:

```bash
npm test
```

Production dependency audit:

```bash
npm audit --omit=dev --audit-level=high
```

Repository whitespace check:

```bash
git diff --check
```

## 9. Development seed

The seed script is intentionally opt-in and must never be enabled in production:

```bash
ALLOW_DEV_SEED=true npm run db:seed
```

If the database already contains users, the seed command skips the operation.

## 10. Platform administrator bootstrap

Platform administration is separate from organization roles.

To grant platform capability to an existing account from a trusted server shell:

```bash
npm run platform:grant-admin -- admin@example.com
```

This does **not** change the user's organization role. Platform capability is stored separately in `platform_administrators`.

## 11. Organization setup

A platform administrator can provision an organization from `/platform`. Provisioning creates the organization, organization settings, initial administrator, and Phase 2.2 default recruitment stages atomically.

For a new organization:

1. Provision the organization from the platform administration screen.
2. Sign in as the initial administrator.
3. Create/link employees and organization members.
4. Use `/recruitment` to create jobs, candidates, and applications.
5. Move applications through the controlled workflow.
6. Schedule interviews from the application workspace or `/recruitment/interviews`.
7. Assign one or more organization users to the interview panel.
8. Complete the interview and allow assigned interviewers to submit feedback.
9. Record a human interview decision.

## 12. Recruitment workflow

The application lifecycle remains controlled server-side:

```text
applied
   ↓
screening
   ↓
shortlisted
   ↓
interview
   ↓
evaluation
   ↓
offer
   ↓
hired
```

Rejection and withdrawal are controlled exits. Rejected/withdrawn records can move to archived.

Phase 2.2 adds tenant-owned workflow stage configuration. The ten lifecycle stages retain stable status keys while their display names, order, and active state can be managed from `/recruitment/stages`. This deliberately avoids turning SYJ-HCM into an arbitrary executable workflow engine.

The server validates every transition independently of the UI.

## 13. Interview workflow

An application may have multiple rounds. Each round can contain one or more interview sessions.

```text
Application
  ├─ Round 1: Screening
  │    └─ Interview session
  ├─ Round 2: Technical
  │    └─ Interview session
  ├─ Round 3: Manager
  │    └─ Interview session
  └─ Round 4: Final
       └─ Interview session
```

Interview sessions contain:

- application and round
- title and controlled interview type
- status
- canonical UTC start/end timestamps
- intended IANA timezone
- location/meeting details
- organizer
- panel membership

Interviewers are existing organization users. Assignment does not grant global recruitment permissions.

## 14. Scheduling and time zones

The scheduling form accepts a local wall-clock datetime plus an explicit IANA timezone such as `Asia/Kolkata`.

The server validates the local time and converts it to a canonical UTC ISO timestamp. The original timezone is retained for correct display.

The system rejects invalid dates, invalid/nonexistent local times, and `end <= start`.

Interviewer conflicts are checked server-side. Active overlapping interviews for the same interviewer are rejected. Scheduling and participant creation occur under SQLite `BEGIN IMMEDIATE` transaction semantics so concurrent writers cannot interleave the critical operation on the application connection.

## 15. Interview status lifecycle

```text
scheduled → confirmed → completed
scheduled → cancelled
scheduled → rescheduled → confirmed/completed
confirmed → cancelled
confirmed → no_show
```

Completed, cancelled, and no-show interviews cannot be silently rewritten through the normal lifecycle actions.

## 16. Feedback and decisions

Feedback is structured:

- score: 1–5
- recommendation: `strong_yes`, `yes`, `neutral`, `no`, `strong_no`
- strengths
- concerns
- notes
- submitting interviewer
- server timestamp

Only an assigned interviewer can submit their own feedback. HR/admin can review authorized organizational feedback. Submitted feedback is immutable.

Corrections are stored separately with the previous values, new values, actor, reason, and timestamp. This preserves the historical evaluation instead of silently overwriting it.

Interview decisions are controlled:

```text
advance
hold
reject
```

`advance` integrates with the application workflow by moving an eligible application to `evaluation`. `reject` moves an eligible application to `rejected`. `hold` records the decision without forcing a lifecycle transition.

## 17. Candidate activity timeline

Business activity is separate from security/compliance audit logging.

Candidate activities include real workflow events such as:

- candidate creation/update
- application creation
- stage changes
- interview scheduling/rescheduling/cancellation
- interviewer assignment/removal
- feedback submission/correction
- decisions
- notes
- rejection/withdrawal/archive

Activity records are append-only and tenant scoped. The existing immutable `audit_logs` table remains the security/compliance event stream.

## 18. Recruitment notes

Internal recruitment notes can be attached to a candidate and optionally to a specific application.

Notes are:

- tenant scoped
- server-authorized
- length validated
- rendered as plain text
- audit logged
- excluded from employee-facing recruitment access

No HTML is rendered from note content.

## 19. Recruitment UI routes

```text
/recruitment
/recruitment/jobs
/recruitment/jobs/new
/recruitment/jobs/[id]
/recruitment/candidates
/recruitment/candidates/new
/recruitment/candidates/[id]
/recruitment/applications
/recruitment/applications/new
/recruitment/applications/[id]
/recruitment/interviews
/recruitment/interviews/new
/recruitment/interviews/[id]
/recruitment/stages
```

The application detail page is the central recruitment workspace. Candidate detail includes applications, notes, interviews, and the business activity timeline.

Assigned employees can access their own interview records directly through `/recruitment/interviews`; they do not receive general ATS management permissions.

## 20. RBAC and tenant isolation

Organization roles remain:

- `admin`
- `hr`
- `employee`

Admin and HR receive recruitment management capabilities through the existing server-side authorization architecture.

Employees do not receive unrestricted ATS access. An employee assigned as an interviewer can access the specific interview permitted by the interviewer ownership check and can submit their own feedback after completion.

Every recruitment query/mutation uses the authenticated organization context. Client-provided organization IDs are never accepted as tenant authority.

Database relationships use `(organization_id, id)` composite foreign-key protection where appropriate, preventing cross-tenant references such as an organization A interview pointing at an organization B application or interviewer.

Suspended organizations are rejected both by the authenticated Server Action boundary and by Phase 2.2 business mutation guards.

## 21. Audit and history

Security/compliance events continue to use the existing immutable tenant audit infrastructure.

Phase 2.2 additionally records business workflow activity and application stage history. This separation avoids duplicating the audit system while preserving the history users need for recruitment operations.

Important recruitment events are audit logged, including stage changes, interview mutations, participant changes, feedback submission/correction, decisions, and protected note changes.

## 22. Migration validation

For a fresh database:

```bash
npm run db:migrate
```

For an existing v0.10.0-alpha database, the same command applies only the new `0006` migration and preserves previous data.

Migration idempotency is validated by running the migration runner again; already-applied migrations are skipped.

Foreign-key integrity can be checked with the repository SQLite client or a trusted SQLite shell:

```sql
PRAGMA foreign_key_check;
```

The expected result is zero rows.

## 23. Production deployment guidance

Development:

```bash
npm ci
cp .env.example .env
# configure a development SESSION_SECRET
npm run db:migrate
npm run dev
```

Production:

```bash
npm ci
# configure production .env outside source control
npm run db:migrate
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
npm start
```

Use a unique production `SESSION_SECRET`. Protect the SQLite file and its WAL files with filesystem permissions. Back up the database using a SQLite-aware backup strategy rather than copying a live WAL database blindly. Keep `.env` outside source control and use a secret-management mechanism appropriate to the deployment environment.

## 24. Troubleshooting

### Missing session secret

Error:

```text
SESSION_SECRET must be configured with at least 32 characters.
```

Generate a random secret and put it in `.env`:

```bash
openssl rand -hex 32
```

### Pending migrations

If production startup reports pending migrations:

```bash
npm run db:migrate
```

Then retry:

```bash
npm start
```

### Missing database

Create the schema with:

```bash
npm run db:migrate
```

### Port already in use

Stop the existing Node/Next process or choose an available development port using the normal Next.js CLI/environment configuration.

### Permission problems

Ensure the directory containing `DATABASE_PATH` is writable by the application process.

### Startup schema validation failure

Do not bypass the check. Run migrations and inspect the exact missing table/configuration message:

```bash
npm run db:migrate
```

### SQLite locked/busy errors

The application enables WAL mode and a 5-second busy timeout. Avoid opening the production database with multiple ad-hoc writers while the server is running.

## 25. Security notes

- Tenant authority comes from the authenticated server-side session.
- Organization lifecycle status is enforced server-side.
- Sessions are DB-backed, signed, time bounded, and revoked on relevant security events.
- Recruitment mutations use role/capability checks and tenant-scoped resource validation.
- Sensitive feedback and notes are not employee-global data.
- Audit logs are protected by database triggers.
- Recruitment activity is append-only.
- No real credentials belong in source control.
- SQLite runtime data is excluded from Git.
- No native SQLite dependency is used.

## 26. Phase 2.3 document security and operations

Candidate document binaries are never stored in SQLite or public static directories. Uploads are validated server-side, tenant-bound, checksum recorded, and passed through an explicit malware-scanner abstraction. The bundled development scanner reports `scanner_unavailable`; it does not claim files are virus-free.

The initial production-safe limit is 12 MiB per document. Allowed content is PDF, DOCX, legacy DOC, TXT, PNG, JPEG, WebP and GIF. SVG/HTML/active-content formats and arbitrary ZIP/executable signatures are rejected.

Documents are HR/admin-only in this phase. Interview assignment does not automatically grant document access. Deletion is represented by archive/restore, while physical cleanup is deliberately separate. See `DOCUMENT_STORAGE.md` for operational guidance.

## 27. Current limitations / deliberate deferrals

Phase 2.3 intentionally does **not** implement:

- email/SMS/WhatsApp notifications
- calendar-provider integration
- public job publishing
- careers portal
- candidate self-service
- cloud object-storage provider implementation
- autonomous malware scanning engine
- automated retention deletion engine
- offer management
- advanced analytics infrastructure
- AI candidate scoring or automated hiring decisions
- payroll
- billing
- arbitrary workflow scripting

Interview scheduling is stored and validated in SYJ-HCM itself; external calendar synchronization is future work.

The stage configuration foundation uses stable ATS lifecycle status keys with configurable labels/order/active state rather than a generic workflow execution engine.

## 28. Phase roadmap

```text
Phase 1       Core HR                                  COMPLETE
Phase 1.1     Production Security Hardening             COMPLETE
Phase 1.2     Multi-Tenant Foundation                   COMPLETE
Phase 1.2b    Organization / Tenant Management          COMPLETE
Phase 1.2c    SaaS Productization Foundation            COMPLETE
Phase 2.1     Recruitment / ATS Foundation              COMPLETE
Phase 2.2     Recruitment Workflow & Interviews         COMPLETE
Phase 2.3     Candidate Documents & Resume Management   CURRENT
Phase 2.4     Job Publishing + Careers Portal
Phase 2.5     Offer Management
Phase 2.6     Recruitment Analytics
Phase 3       HCM Operations / Onboarding
```

## 29. Phase 2.3 delivery note

Phase 2.3 delivers the secure document-management foundation without putting arbitrary files into SQLite. It uses private local storage behind a storage abstraction, server-side upload validation, malware-scanning integration points, tenant isolation, authenticated attachment downloads, archive/restore semantics, checksums, and document audit events. S3-compatible object storage and a real AV engine remain explicit deployment extensions rather than hidden assumptions.

## 30. License / project status

This repository is the SYJ-HCM development codebase for SAYANJALI NEXUS. The current version is an alpha development release and should undergo environment-specific security, backup, operational, and acceptance testing before production deployment.

# SYJ-HCM Phase 2.4 — Job Publishing & Careers

**Target release:** `v0.13.0-alpha`
**Base:** `854f2e0dc8646e8dcca2f52538ff0419273da353`
**Migration:** `0008_phase2_4_job_publishing.sql`

## Implementation

Phase 2.4 adds a dedicated `job_publications` boundary between internal ATS requisitions and public recruitment. The public layer is not a boolean flag on `job_requisitions` and does not serialize the internal requisition object.

Delivered:

- tenant-local publication records with globally unique public slugs
- draft/published/closed/archived publication lifecycle
- server-authorized HR/Admin publication management
- organization-level `public_careers_enabled` control, admin-only
- public `/careers` listing with search/filtering
- public `/careers/[slug]` detail pages
- public `/careers/[slug]/apply` application UI
- `POST /api/careers/[slug]/applications` hostile-input boundary
- server-side eligibility re-check at submission time
- existing candidate/application lifecycle reuse
- duplicate active-application protection inside SQLite transaction
- public cover-letter storage on the existing application record
- Phase 2.3 private resume storage reuse
- existing MIME/magic-byte/filename/size/scanner behavior reused for resumes
- SQLite-backed HMAC-keyed rate limiting plus honeypot/minimum-submit-time checks
- same-origin request validation and bounded multipart requests
- public DTO/data-minimization boundary
- suspended-tenant exclusion
- request-time closing-date enforcement and automatic internal publication closure on read
- internal audit events for publication and public intake operations
- startup validation for Phase 2.4 schema objects
- 33 dedicated Phase 2.4 SQLite/security invariant tests

## Public security boundary

Public requests derive the tenant from the publication resolved by the public slug. The browser cannot supply `organization_id`, `job_requisition_id`, `candidate_id`, `application_id`, recruiter IDs, or stage IDs as authoritative identifiers.

Public output is an explicit DTO containing only organization name, title, description, location, employment type, workplace type, department, publication/closing information, and application availability.

Private ATS fields such as salary, requirements, skills, recruiter identity, hiring manager identity, notes, interviews, candidate data, audit records, and document storage keys are not part of the publication DTO.

## Resume behavior

Resumes use the Phase 2.3 `uploadCandidateDocument` service and private storage. No public upload directory or storage URL was introduced. `scanner_unavailable` remains a non-clean scanner state; the application may be accepted while the resume remains non-downloadable/pending according to the existing document lifecycle.

Public application history/activity uses the requisition creator as the tenant-local actor because the existing immutable ATS history/activity schema requires a user actor. Audit payloads contain no applicant PII.

## Abuse controls

The current deployment has no Redis dependency. Rate limiting is stored in SQLite and keyed using HMAC-SHA256 values derived from the configured session secret. The implementation applies publication/IP and publication/email controls, a minimum submission interval, a request-count window, a server-side honeypot, and a server-side minimum form age.

Before horizontal multi-instance deployment, replace the rate-limit persistence behind a distributed implementation. Reverse proxies must normalize client IP headers before trusting `X-Forwarded-For`/`X-Real-IP` for rate limiting.

## Validation actually performed in this handoff

### Passed

- Fresh migration SQL `0000 → 0008` executed directly with Node 22's built-in `node:sqlite`.
- Phase 2.4 migration tables, columns, indexes and triggers verified.
- Historical migration files `0000–0007` verified byte-for-byte against the supplied v0.12.0 source bundle.
- 33 dedicated Phase 2.4 SQLite/security invariant tests: **33/33 PASS**.
- New/modified TypeScript/TSX files transpile successfully with the installed global TypeScript compiler as a syntax-level check.

### NOT VERIFIED — ENVIRONMENT LIMITATION

The supplied source bundle did not contain a usable installed dependency tree. `npm ci` could not complete because registry access was unavailable in the build environment. Therefore the following required repository gates could not be honestly reported as passing:

- `npm test` — **NOT VERIFIED — ENVIRONMENT LIMITATION** (`tsx` unavailable)
- `npm run typecheck` — **NOT VERIFIED — ENVIRONMENT LIMITATION** (dependency/type-definition tree incomplete)
- `npm run build` — **NOT VERIFIED — ENVIRONMENT LIMITATION** (`next` unavailable)
- `npm audit --omit=dev --audit-level=high` — **NOT VERIFIED — ENVIRONMENT LIMITATION** (npm registry audit endpoint unavailable)
- full application-level Phase 2.4 integration tests — **NOT VERIFIED — ENVIRONMENT LIMITATION**
- production Next.js route/build verification — **NOT VERIFIED — ENVIRONMENT LIMITATION**

No production validation is being claimed for those gates.

## Git discipline

No Git commit, tag, push, release, PR, or history rewrite was performed. The implementation is delivered as an archive for owner-side review and final Git operations.

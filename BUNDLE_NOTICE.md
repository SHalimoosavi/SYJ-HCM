# SYJ-HCM v0.11.0-alpha — Phase 2.2 Build Bundle

**Phase 2.2 — Recruitment Workflow & Interview Management**

This bundle is built directly on the verified `v0.10.0-alpha` / commit `85c5f08` baseline.

## Included

- configurable ATS lifecycle stage configuration
- application stage history extensions
- candidate/application business activity timeline
- internal recruitment notes
- interview rounds and interview sessions
- interview scheduling with IANA timezone handling and canonical UTC timestamps
- interviewer/panel membership with tenant-safe relationships
- server-side interviewer conflict detection
- structured immutable interview feedback
- explicit feedback correction history
- controlled interview decisions integrated with application lifecycle
- HR/admin recruitment management
- assigned-interviewer access for employee users without granting global ATS management
- tenant isolation and suspended-organization enforcement
- recruitment dashboard and interview UI
- Phase 2.2 automated security/domain tests
- complete installation/deployment documentation
- additive migration `drizzle/0006_phase2_2_recruitment_workflow_interviews.sql`

## Architecture preserved

Next.js + TypeScript + React + Server Actions + Drizzle ORM + `drizzle-orm/sqlite-proxy` + Node.js built-in `node:sqlite` + SQLite.

No native SQLite binaries, Redis, Kafka, RabbitMQ, PostgreSQL, microservices, Kubernetes, or external search service are introduced.

## Deliberate boundaries

This phase does not implement external email/SMS, calendar synchronization, resume/document storage, public careers publishing, candidate self-service, offer management, advanced analytics infrastructure, payroll, billing, or AI hiring decisions.

## Validation

The bundle is intended to be validated with:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Do not place `.env`, databases, secrets, `node_modules`, `.next`, or runtime caches into the release archive.

Build-sandbox note: dependency installation (`npm ci`) was blocked by sandbox package-network timeout, so full `npm test`, `npm run typecheck`, and `npm run build` require final validation in the target Node/npm environment. SQL migration, foreign-key, business-runtime smoke, source parsing, dependency-diff, whitespace, and offline lockfile audit checks were completed locally in the build sandbox.

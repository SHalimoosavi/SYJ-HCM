# SYJ-HCM

Sayanjali Human Capital Management — Phase 1 (Core HR).

Real, working software: every action in this app reads and writes an actual
SQLite database via Drizzle ORM. There is no mocked data, no fake CRUD, and
no hardcoded dashboard numbers.

## Phase 1 scope

- Authentication (email + password, hashed with scrypt, DB-backed sessions)
- Role-based authorization (admin / hr / employee) enforced server-side
- Employee management (create, edit, search/filter/sort, activate/deactivate)
- Employee self-service (profile, leave balance, change password)
- Leave management (apply, approve, reject, cancel; balance + overlap validation)
- Attendance (clock in/out, optional browser GPS, server-authoritative timestamps)
- HR/admin dashboard with live database-derived metrics
- Audit logging for all sensitive actions

Phases 2–4 (Recruiting, Operations, Payroll/Analytics) are intentionally not
built yet, but the schema and module boundaries are structured so they can be
added without reworking Phase 1.

## Tech stack

- Next.js 14 (App Router, Server Actions)
- TypeScript
- Drizzle ORM, connected to Node's built-in `node:sqlite` module via Drizzle's
  stable `sqlite-proxy` driver (see "Database driver" below for why — no
  native binaries, no `better-sqlite3`)
- Tailwind CSS
- `node:test` for the test suite (no test framework dependency)

This matches a zero-native-binary constraint: every dependency is pure
JS/TS, and the database driver is a Node built-in rather than a compiled
native module.

## Requirements

- Node.js **22.5.0 or later** (`node:sqlite` requires this; algorithms were
  hand-verified against Node 22.22 in a sandbox, and the project has since
  been confirmed running under Node 24.18.0)
- A machine/environment **with internet access** for the initial
  `npm install` (this codebase was written in a network-isolated sandbox and
  has not had `npm install` run against it yet — see "What has and hasn't
  been run" below)

## Setup

```bash
cd syj-hcm
npm install
cp .env.example .env
# Edit .env and set a real SESSION_SECRET, e.g.:
#   openssl rand -hex 32
```

## Database driver

`src/db/client.ts` connects to `node:sqlite` (Node's built-in module,
**not** a native addon) through Drizzle's `drizzle-orm/sqlite-proxy` driver,
not `drizzle-orm/node-sqlite`.

Why: Drizzle's dedicated `node-sqlite` driver only ships on the 1.0
beta/RC release line — it was never backported to the 0.4x stable branch.
On stable `drizzle-orm@0.45.2`, `import { drizzle } from
'drizzle-orm/node-sqlite'` fails at build time with "Package path
./node-sqlite is not exported from package", because that export genuinely
does not exist in this version. `sqlite-proxy`, by contrast, has been part
of stable Drizzle since 0.29.x — it just asks for a callback that executes
SQL however you like and returns rows as plain arrays, so `client.ts`
implements that callback directly against `node:sqlite`'s synchronous
`DatabaseSync.prepare().all()/.get()/.run()`. Nothing outside that one file
changed — `db.select()/.insert()/.update()/.delete()` behave identically
everywhere else in the app.

If a future Drizzle stable release re-exports `node-sqlite` (or you
deliberately move to the 1.0 line once it's out of RC), `client.ts` is the
only file that would need to change back.

## Database

This project ships a hand-written initial migration
(`drizzle/0000_init.sql`) that matches `src/db/schema.ts` exactly, and a
small custom migration runner (`scripts/migrate.ts`) that applies any `.sql`
file in `drizzle/` that hasn't been applied yet, tracked in a local
`__migrations` table. This was necessary because `drizzle-kit`'s `migrate`/
`push`/`studio` commands do not yet fully support the `node:sqlite` driver
for live connections (as of writing, they expect `better-sqlite3`, `bun`, or
a libSQL/Turso connection) — `drizzle-kit generate` still works for
schema-diffing since it doesn't need a live connection, but **use `npm run
db:migrate` to actually apply migrations**, not `drizzle-kit migrate`.

```bash
npm run db:migrate
```

This creates the SQLite file at the path in `DATABASE_PATH` (default
`./data/syj-hcm.db`), with every table, index, and foreign key from the
schema.

### Seeding (development only)

```bash
ALLOW_DEV_SEED=true npm run db:seed
```

This refuses to run unless `ALLOW_DEV_SEED=true` is set, and refuses to run
a second time if the `users` table already has rows. It creates:

- `admin@syj-hcm.local` / `ChangeMe123!` (role: admin)
- `sana@syj-hcm.local` / `ChangeMe123!` (role: employee)

**Change these passwords immediately in any environment other than local
development.**

## Security / npm audit

`postcss` is pinned as a direct devDependency at `^8.5.28` (patched against
GHSA-qx2v-qp2m-jg93). Next.js also vendors its **own** nested copy of
postcss internally (`next/node_modules/postcss`), independent of the
project's direct dependency — this is a long-standing, widely-reported
Next.js packaging issue (see `vercel/next.js` issues #93234, #93604,
#93718), not something fixable by bumping the direct dependency alone.

- **Which package introduces it**: `next/node_modules/postcss` (bundled
  inside Next.js itself), not this project's own `postcss`.
- **Runtime reachability**: the advisory concerns unsafe handling during
  CSS parsing/stringification. Next's internal postcss pipeline runs
  against this app's own build-time CSS/Tailwind sources, not against
  arbitrary attacker-supplied CSS at runtime — SYJ-HCM has no feature that
  accepts or renders user-supplied CSS or stylesheets. So while `npm audit`
  correctly flags the vulnerable version being present, it is not
  runtime-reachable by an external attacker through this application's
  actual attack surface.
- **Official patched Next 15 release**: unconfirmed at the time of this
  fix — Next's own fix PR for the nested postcss version exists upstream,
  but whether it has been backported into a specific 15.5.x stable tag
  wasn't independently verifiable from this environment. Check
  https://github.com/vercel/next.js/releases for the specific version
  before relying on an upgrade alone to resolve this.
- **Recommended production resolution** (applied in this fix, in
  `package.json`):
  ```json
  "overrides": {
    "postcss": "^8.5.28"
  }
  ```
  npm's `overrides` field forces every copy of `postcss` in the dependency
  tree — including the one nested inside `next` — to resolve to the
  patched version, without touching Next's own version and without
  `npm audit fix --force` (which would propose an unrelated, unnecessary
  Next 16 upgrade). After running `npm install` with this override in
  place, run `npm ls postcss` to confirm only one resolved version remains
  and `npm audit --omit=dev` to confirm the finding clears.



```bash
npm run dev       # development server, http://localhost:3000
npm run build     # production build
npm run start     # production server (after build)
```

## Testing

```bash
npm test
```

The suite uses `node:test` (built into Node — no Jest/Vitest dependency).
It covers:

- `tests/password.test.ts` — password hashing/verification (scrypt)
- `tests/leave-rules.test.ts` — date-range validation and day counting
- `tests/leave-overlap-and-balance.test.ts` — overlap detection and leave
  balance calculation, run against a real temporary SQLite database
  (created fresh per test run via `tests/helpers/setup-test-db.ts`)
- `tests/attendance-constraint.test.ts` — verifies the database itself
  rejects a second attendance record for the same employee on the same day
- `tests/auth.test.ts` — role-checking helper

## Linting and type-checking

```bash
npm run lint
npm run typecheck
```

## What has and hasn't been run

This codebase was written in a network-isolated sandbox (no access to the
npm registry), so the following could **not** be executed there and need to
be run by you, in an environment with network access, before you trust this
as "done":

- `npm install`
- `npm run build`
- `npm run lint` / `npm run typecheck` (with real `next`/`drizzle-orm`/
  `@types/*` installed)
- `npm test` (the full suite, which needs `drizzle-orm` and `nanoid`
  installed)
- Actually clicking through the app in a browser

What **was** verified in the sandbox, for real, before hand-off:

- The core algorithms (password hashing/verification, leave date-range
  validation, inclusive day counting) were extracted and executed directly
  with `node --test` against Node 22.22 — genuinely run, not just written.
- A static analysis pass was run with a globally-available `tsc` against
  the whole `src/` tree to catch syntax errors, malformed JSX, and logic
  bugs independent of the (unavailable) third-party type declarations —
  several real issues were found and fixed this way (see below).
- The `node:sqlite` + Drizzle connection pattern, the `drizzle-orm`/
  `drizzle-kit` version pins, and the Next.js 14 config key names were all
  checked against current documentation/changelogs rather than assumed from
  training data, since dependency APIs shift over time.

Please run the full command list above and open an issue/fix forward if
anything surfaces that the offline checks couldn't catch (mainly: exact
`next.config.mjs` behavior, real React 18 JSX type-checking, and any
transitive dependency resolution issues).

## Project structure

```
src/
  app/
    login/                  Public login page + server action
    (app)/                  Authenticated route group
      layout.tsx            The real auth boundary (requireUser())
      dashboard/            Live-data dashboard
      employees/            Employee CRUD (HR/admin only)
      leave/                Apply / approve / reject / cancel
      attendance/           Clock in/out + history
      profile/              Self-service + change password
  db/
    schema.ts               Drizzle schema (all tables + relations)
    client.ts                node:sqlite + Drizzle connection
  lib/
    auth.ts                 requireUser/requireRole (pages) and
                             requireUserForAction/requireRoleForAction
                             (Server Actions) — the real authorization
                             enforcement points
    session.ts               DB-backed, HMAC-signed cookie sessions
    password.ts               scrypt hashing (no native deps)
    leave-rules.ts            Overlap detection, balance checks, date math
    audit.ts                  Audit log writer
  middleware.ts              Edge-runtime UX redirect only (NOT the
                              authorization boundary — see comments in file)
drizzle/0000_init.sql        Hand-written initial migration
scripts/migrate.ts           Custom migration runner
scripts/seed.ts              Dev-only seed data
tests/                       node:test suite
```

## Known limitations (honest, not hidden)

- Leave balances are tracked per calendar year; a request spanning a year
  boundary (e.g. Dec 30 – Jan 2) is checked against the start date's year
  only. Fine for Phase 1, worth revisiting before Phase 4 payroll work.
- Attendance records are only ever created with `status: 'present'` when an
  employee clocks in. There is no scheduled job yet to mark employees
  `absent` at end-of-day if they never clocked in — the dashboard's "Absent
  Today" figure is derived (`active employees − present − on leave`), not
  from a stored `absent` row. This is accurate, not fabricated, but a
  proper end-of-day job is a natural Phase 1.1 addition.
- No automated CI is configured; `npm test`/`npm run lint`/`npm run
  typecheck` are meant to be run manually or wired into your own CI.

## Git

This repo has not been initialized with git or pushed anywhere from the
sandbox (no network access there). To publish:

```bash
cd syj-hcm
git init
git add -A
git commit -m "feat: SYJ-HCM Phase 1 - core HR (employees, leave, attendance, auth, dashboard)"
git branch -M main
git remote add origin https://github.com/SHalimoosavi/SYJ-HCM.git
git push -u origin main
```

# SYJ-HCM v0.9.5-alpha — Phase 1.2c Build Bundle

This bundle is the complete repository build artifact for:

**SYJ-HCM v0.9.5-alpha — Phase 1.2c Productization / SaaS Foundation**

## Source baseline

- Baseline: `v0.9.4-alpha`
- Baseline commit: `d4f7a944fce83864894fe37ab2534e0088b97c25`
- Build source: complete Phase 1.2b repository ZIP

## Included

The archive contains the complete source repository state required for local validation, including:

- application source
- platform administration
- organization management
- tenant configuration
- tests
- database migrations
- package metadata and lockfile
- CI workflow
- scripts
- README
- phase reports

## Intentionally excluded

The archive does not contain:

- `.git`
- `node_modules`
- `.next`
- `.env` / `.env.*`
- local database files
- SQLite database artifacts
- TypeScript build caches
- private keys or credentials

## Local workflow

Preserve your existing Git checkout and replace/update the repository working tree from this archive.

Then run:

```bash
npm ci
npm run db:migrate
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Also manually validate:

- platform administrator authorization
- organization provisioning
- provisioning rollback
- tenant suspension
- tenant recovery
- organization configuration isolation
- existing Phase 1 / 1.1 / 1.2a / 1.2b workflows

## GitHub operations

No GitHub push, tag, PR, merge, or release operation is performed by the build artifact.

Recommended release tag:

```text
v0.9.5-alpha
```

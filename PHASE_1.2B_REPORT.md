# SYJ-HCM Phase 1.2b — Organization / Tenant Management

## Scope

Phase 1.2b turns the Phase 1.2a tenant foundation into an authenticated organization administration layer without introducing a second authorization model or changing the established SQLite/Drizzle architecture.

## Implemented

- Organization administration is restricted to the existing `admin` role.
- Organization identity can be viewed and updated from the authenticated organization context.
- Organization name and slug validation is enforced server-side.
- Organization slug uniqueness is checked against the existing tenant root.
- Organization members can be listed only from the actor's authenticated `organizationId`.
- Organization administrators can activate/deactivate other members in their organization.
- Organization administrators can change member roles among `admin`, `hr`, and `employee`.
- Organization administrators can link an existing employee record to an existing member account, but only within the same organization.
- Cross-organization employee/user linking is rejected server-side.
- Member deactivation revokes that member's sessions in the same transaction as the account state change.
- The system refuses to remove the final active administrator through member management.
- Administrators cannot deactivate or change their own role through member management, preventing accidental administrative lockout.
- Security-sensitive organization/member mutations are written through the existing immutable, tenant-aware audit infrastructure.
- Organization management navigation is exposed only to administrators.

## Database

No new migration is required. Phase 1.2a already introduced the required `organizations.status`, identity metadata, tenant-scoped users, sessions, employees, and audit relationships. Phase 1.2b consumes those structures without modifying historical migrations or resetting populated databases.

## Security model

The browser never supplies an authoritative organization identifier. Every organization-management read and mutation derives the organization from `getCurrentUser()` and then applies an explicit organization predicate at the database boundary.

Member operations use `(user_id, organization_id)` predicates. Employee linking uses `(employee_id, organization_id)` predicates. No transfer between organizations is supported.

## Lifecycle decision

The existing `organizations.status` field remains visible as tenant state, but Phase 1.2b does not expose a destructive delete or a UI suspension workflow. This avoids creating a self-locking tenant where the last administrator cannot reactivate the organization. A future controlled lifecycle/provisioning phase can add suspension/recovery semantics with an explicit recovery path.

## Validation

All required local validation completed successfully:

```text
npm ci                         PASS
npm test                       PASS — 56/56
npm run typecheck              PASS
npm run build                  PASS
npm audit --audit-level=high  PASS — 0 high / 0 critical
git diff --check               PASS
```

`npm audit` reports four moderate development-toolchain vulnerabilities through the existing `drizzle-kit` → esbuild dependency chain. No high or critical vulnerabilities were reported. `npm audit fix --force` was not used because the available forced remediation would introduce a breaking dependency change outside Phase 1.2b scope.

The complete Phase 1.2b release bundle is prepared from the local repository state based on GitHub `main` commit `d6aee8db8a159c1be88f20e360fd27754894735f`. No GitHub push, merge, or tag has been performed.

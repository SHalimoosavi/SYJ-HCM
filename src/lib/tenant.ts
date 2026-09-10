/**
 * Tenant context is resolved exclusively from the authenticated database user.
 * Client-provided organization identifiers are never accepted as authority.
 */
export const DEFAULT_ORGANIZATION_ID = 'org_default';

export type TenantContext = {
  organizationId: string;
};

export function getTenantContext(organizationId: string): TenantContext {
  if (!organizationId) throw new Error('Authenticated user is missing organization context.');
  return { organizationId };
}

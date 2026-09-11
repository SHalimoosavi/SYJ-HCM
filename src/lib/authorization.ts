import type { CurrentUser } from './session';

export function isRoleAllowed(role: CurrentUser['role'], roles: readonly CurrentUser['role'][]): boolean {
  return roles.includes(role);
}

export function canAccessOrganization(actorOrganizationId: string, targetOrganizationId: string): boolean {
  return Boolean(actorOrganizationId) && actorOrganizationId === targetOrganizationId;
}

export function canManageOrganization(role: CurrentUser['role']): boolean {
  return role === 'admin';
}

export function canManageEmployees(role: CurrentUser['role']): boolean {
  return isRoleAllowed(role, ['admin', 'hr']);
}

export function canApproveLeave(role: CurrentUser['role']): boolean {
  return isRoleAllowed(role, ['admin', 'hr']);
}

export function canCancelLeave(
  role: CurrentUser['role'],
  actorEmployeeId: string | null,
  targetEmployeeId: string,
  actorOrganizationId: string,
  targetOrganizationId: string
): boolean {
  if (!canAccessOrganization(actorOrganizationId, targetOrganizationId)) return false;
  return actorEmployeeId === targetEmployeeId || canApproveLeave(role);
}

export function canAccessOwnEmployeeRecord(
  actorEmployeeId: string | null,
  targetEmployeeId: string,
  actorOrganizationId: string,
  targetOrganizationId: string
): boolean {
  return (
    canAccessOrganization(actorOrganizationId, targetOrganizationId) &&
    actorEmployeeId !== null &&
    actorEmployeeId === targetEmployeeId
  );
}

export const authorizationMatrix = {
  admin: {
    organization: ['read', 'update', 'manage_members'],
    employees: ['create', 'read', 'update', 'activate', 'deactivate'],
    recruitment: ['create', 'read', 'update', 'manage_jobs', 'manage_candidates', 'manage_applications'],
    leave: ['apply_own', 'read_own', 'cancel_own', 'approve', 'reject'],
    attendance: ['clock_own', 'read_own', 'read_org_summary'],
    profile: ['read_own', 'change_password', 'revoke_other_sessions']
  },
  hr: {
    organization: ['read_own_context'],
    employees: ['create', 'read', 'update', 'activate', 'deactivate'],
    recruitment: ['create', 'read', 'update', 'manage_jobs', 'manage_candidates', 'manage_applications'],
    leave: ['apply_own', 'read_own', 'cancel_own', 'approve', 'reject'],
    attendance: ['clock_own', 'read_own', 'read_org_summary'],
    profile: ['read_own', 'change_password', 'revoke_other_sessions']
  },
  employee: {
    organization: ['read_own_context'],
    employees: [],
    recruitment: [],
    leave: ['apply_own', 'read_own', 'cancel_own'],
    attendance: ['clock_own', 'read_own'],
    profile: ['read_own', 'change_password', 'revoke_other_sessions']
  }
} as const;

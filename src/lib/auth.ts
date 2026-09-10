import { redirect } from 'next/navigation';
import { getCurrentUser, type CurrentUser } from './session';
import { recordAudit } from './audit';
import { isRoleAllowed } from './authorization';

export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * For use in Server Components / pages. Redirects to /login if unauthenticated.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    await recordAudit({
      actorUserId: null,
      action: 'authorization_failed',
      entityType: 'authorization',
      entityId: 'anonymous',
      metadata: { reason: 'not_authenticated', boundary: 'page' }
    });
    redirect('/login');
  }
  return user;
}

/**
 * For use in Server Components / pages that must be restricted to specific roles.
 * Redirects to /dashboard (not just hides UI) if the role doesn't match.
 */
export async function requireRole(...roles: Array<CurrentUser['role']>): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isRoleAllowed(user.role, roles)) {
    await recordAudit({
      actorUserId: user.id,
      action: 'authorization_failed',
      entityType: 'authorization',
      entityId: user.id,
      metadata: { reason: 'role_denied', role: user.role, requiredRoles: roles, boundary: 'page' }
    });
    redirect('/dashboard');
  }
  return user;
}

/**
 * For use inside Server Actions, where redirect() is less appropriate than
 * throwing - the caller decides how to surface the error to the UI.
 * This is the actual enforcement point: every mutating action must call this,
 * so authorization cannot be bypassed by calling the action directly.
 */
export async function requireUserForAction(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    await recordAudit({
      actorUserId: null,
      action: 'authorization_failed',
      entityType: 'authorization',
      entityId: 'anonymous',
      metadata: { reason: 'not_authenticated', boundary: 'server_action' }
    });
    throw new ForbiddenError('Not authenticated.');
  }
  return user;
}

export async function requireRoleForAction(
  ...roles: Array<CurrentUser['role']>
): Promise<CurrentUser> {
  const user = await requireUserForAction();
  if (!isRoleAllowed(user.role, roles)) {
    await recordAudit({
      actorUserId: user.id,
      action: 'authorization_failed',
      entityType: 'authorization',
      entityId: user.id,
      metadata: { reason: 'role_denied', role: user.role, requiredRoles: roles }
    });
    throw new ForbiddenError('You do not have permission to perform this action.');
  }
  return user;
}

export function isHrOrAdmin(role: CurrentUser['role']): boolean {
  return role === 'admin' || role === 'hr';
}

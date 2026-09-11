import { db, sqlite } from '@/db/client';
import { employees, organizations, users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { recordAuditSync } from './audit';
import { ForbiddenError } from './auth';
import type { CurrentUser } from './session';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type OrganizationUpdateInput = {
  name: string;
  slug: string;
};

export function validateOrganizationDetails(input: OrganizationUpdateInput): string | null {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (name.length < 2 || name.length > 100) return 'Organization name must be between 2 and 100 characters.';
  if (slug.length < 3 || slug.length > 64 || !SLUG_PATTERN.test(slug)) {
    return 'Slug must be 3–64 characters and contain only lowercase letters, numbers, and single hyphens.';
  }
  return null;
}

export function assertOrganizationAdmin(user: CurrentUser): void {
  if (user.role !== 'admin') throw new ForbiddenError('Only organization administrators can manage organization settings.');
}

export async function getOrganizationForAdmin(user: CurrentUser) {
  assertOrganizationAdmin(user);
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, user.organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOrganizationMembersForAdmin(user: CurrentUser) {
  assertOrganizationAdmin(user);
  const memberRows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      employeeId: users.employeeId,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      employeeCode: employees.employeeCode
    })
    .from(users)
    .leftJoin(
      employees,
      and(eq(users.employeeId, employees.id), eq(employees.organizationId, user.organizationId))
    )
    .where(eq(users.organizationId, user.organizationId));
  return memberRows;
}

export async function getAvailableEmployeesForLinking(user: CurrentUser) {
  assertOrganizationAdmin(user);
  return db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      firstName: employees.firstName,
      lastName: employees.lastName
    })
    .from(employees)
    .where(eq(employees.organizationId, user.organizationId));
}

export function updateOrganizationInTransaction(
  actor: CurrentUser,
  input: OrganizationUpdateInput
): { name: string; slug: string } {
  assertOrganizationAdmin(actor);
  const error = validateOrganizationDetails(input);
  if (error) throw new Error(error);

  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const existing = sqlite
    .prepare('SELECT id FROM organizations WHERE slug = ? AND id <> ? LIMIT 1')
    .get(slug, actor.organizationId) as { id?: string } | undefined;
  if (existing?.id) throw new Error('That organization slug is already in use.');

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite
      .prepare('UPDATE organizations SET name = ?, slug = ?, updated_at = current_timestamp WHERE id = ?')
      .run(name, slug, actor.organizationId);

    recordAuditSync({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: 'organization_updated',
      entityType: 'organization',
      entityId: actor.organizationId,
      metadata: { changedFields: ['name', 'slug'] }
    });
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
  return { name, slug };
}

function assertTargetMember(actor: CurrentUser, targetUserId: string): void {
  assertOrganizationAdmin(actor);
  if (!targetUserId) throw new Error('Member identifier is required.');
}

export function setMemberStatusInTransaction(actor: CurrentUser, targetUserId: string, isActive: boolean): void {
  assertTargetMember(actor, targetUserId);
  if (targetUserId === actor.id) throw new Error('You cannot deactivate or reactivate your own account from member management.');

  const target = sqlite
    .prepare('SELECT id, role, is_active FROM users WHERE id = ? AND organization_id = ? LIMIT 1')
    .get(targetUserId, actor.organizationId) as { id?: string; role?: string; is_active?: number } | undefined;
  if (!target?.id) throw new Error('Member not found in your organization.');
  if (Boolean(target.is_active) === isActive) return;

  if (!isActive && target.role === 'admin') {
    const adminCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM users WHERE organization_id = ? AND role = ? AND is_active = 1')
      .get(actor.organizationId, 'admin') as { count?: number } | undefined;
    if (Number(adminCount?.count ?? 0) <= 1) {
      throw new Error('The organization must retain at least one active administrator.');
    }
  }

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite
      .prepare('UPDATE users SET is_active = ?, updated_at = current_timestamp WHERE id = ? AND organization_id = ?')
      .run(isActive ? 1 : 0, targetUserId, actor.organizationId);

    if (!isActive) {
      sqlite
        .prepare('DELETE FROM sessions WHERE user_id = ? AND organization_id = ?')
        .run(targetUserId, actor.organizationId);
    }

    recordAuditSync({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: isActive ? 'organization_member_activated' : 'organization_member_deactivated',
      entityType: 'user',
      entityId: targetUserId
    });
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

export function setMemberRoleInTransaction(
  actor: CurrentUser,
  targetUserId: string,
  role: 'admin' | 'hr' | 'employee'
): void {
  assertTargetMember(actor, targetUserId);
  if (!['admin', 'hr', 'employee'].includes(role)) throw new Error('Invalid organization role.');
  if (targetUserId === actor.id) throw new Error('You cannot change your own role from member management.');

  const target = sqlite
    .prepare('SELECT id, role, is_active FROM users WHERE id = ? AND organization_id = ? LIMIT 1')
    .get(targetUserId, actor.organizationId) as { id?: string; role?: string; is_active?: number } | undefined;
  if (!target?.id) throw new Error('Member not found in your organization.');
  if (target.role === role) return;

  if (target.role === 'admin' && role !== 'admin' && target.is_active) {
    const adminCount = sqlite
      .prepare('SELECT COUNT(*) AS count FROM users WHERE organization_id = ? AND role = ? AND is_active = 1')
      .get(actor.organizationId, 'admin') as { count?: number } | undefined;
    if (Number(adminCount?.count ?? 0) <= 1) {
      throw new Error('The organization must retain at least one active administrator.');
    }
  }

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite
      .prepare('UPDATE users SET role = ?, updated_at = current_timestamp WHERE id = ? AND organization_id = ?')
      .run(role, targetUserId, actor.organizationId);
    recordAuditSync({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: 'organization_member_role_changed',
      entityType: 'user',
      entityId: targetUserId,
      metadata: { role }
    });
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

export function linkEmployeeToMemberInTransaction(
  actor: CurrentUser,
  targetUserId: string,
  employeeId: string | null
): void {
  assertTargetMember(actor, targetUserId);

  const target = sqlite
    .prepare('SELECT id FROM users WHERE id = ? AND organization_id = ? LIMIT 1')
    .get(targetUserId, actor.organizationId) as { id?: string } | undefined;
  if (!target?.id) throw new Error('Member not found in your organization.');

  if (employeeId) {
    const employee = sqlite
      .prepare('SELECT id FROM employees WHERE id = ? AND organization_id = ? LIMIT 1')
      .get(employeeId, actor.organizationId) as { id?: string } | undefined;
    if (!employee?.id) throw new Error('Employee not found in your organization.');

    const linked = sqlite
      .prepare('SELECT id FROM users WHERE employee_id = ? AND organization_id = ? AND id <> ? LIMIT 1')
      .get(employeeId, actor.organizationId, targetUserId) as { id?: string } | undefined;
    if (linked?.id) throw new Error('That employee is already linked to another organization member.');
  }

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite
      .prepare('UPDATE users SET employee_id = ?, updated_at = current_timestamp WHERE id = ? AND organization_id = ?')
      .run(employeeId, targetUserId, actor.organizationId);
    recordAuditSync({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: 'organization_member_employee_link_changed',
      entityType: 'user',
      entityId: targetUserId,
      metadata: { employeeId }
    });
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

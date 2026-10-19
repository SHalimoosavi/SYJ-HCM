import { db, setTenantContext } from '@/db/client';
import { employees, organizations, users, sessions, auditLogs } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { ForbiddenError } from './auth';
import type { CurrentUser } from './session';
import { nanoid } from 'nanoid';

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
  return db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      employeeId: users.employeeId,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      employeeCode: employees.employeeCode,
    })
    .from(users)
    .leftJoin(employees, and(eq(users.employeeId, employees.id), eq(employees.organizationId, user.organizationId)))
    .where(eq(users.organizationId, user.organizationId));
}

export async function getAvailableEmployeesForLinking(user: CurrentUser) {
  assertOrganizationAdmin(user);
  return db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(employees)
    .where(eq(employees.organizationId, user.organizationId));
}

export async function updateOrganizationInTransaction(
  actor: CurrentUser,
  input: OrganizationUpdateInput,
): Promise<{ name: string; slug: string }> {
  assertOrganizationAdmin(actor);
  const error = validateOrganizationDetails(input);
  if (error) throw new Error(error);

  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();

  await db.transaction(async (tx) => {
    await setTenantContext(tx, actor.organizationId);
    const existing = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.slug, slug), sql`${organizations.id} <> ${actor.organizationId}`))
      .limit(1);
    if (existing[0]) throw new Error('That organization slug is already in use.');

    await tx
      .update(organizations)
      .set({ name, slug, updatedAt: new Date().toISOString() })
      .where(eq(organizations.id, actor.organizationId));

    await tx.insert(auditLogs).values({
      id: nanoid(),
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: 'organization_updated',
      entityType: 'organization',
      entityId: actor.organizationId,
      metadata: JSON.stringify({ changedFields: ['name', 'slug'] }),
    });
  });

  return { name, slug };
}

function assertTargetMember(actor: CurrentUser, targetUserId: string): void {
  assertOrganizationAdmin(actor);
  if (!targetUserId) throw new Error('Member identifier is required.');
}

export async function setMemberStatusInTransaction(actor: CurrentUser, targetUserId: string, isActive: boolean): Promise<void> {
  assertTargetMember(actor, targetUserId);
  if (targetUserId === actor.id) throw new Error('You cannot deactivate or reactivate your own account from member management.');

  await db.transaction(async (tx) => {
    await setTenantContext(tx, actor.organizationId);
    const targetRows = await tx
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.organizationId, actor.organizationId)))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new Error('Member not found in your organization.');
    if (target.isActive === isActive) return;

    if (!isActive && target.role === 'admin') {
      const admins = await tx
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.organizationId, actor.organizationId), eq(users.role, 'admin'), eq(users.isActive, true)));
      if (Number(admins[0]?.count ?? 0) <= 1) {
        throw new Error('The organization must retain at least one active administrator.');
      }
    }

    await tx
      .update(users)
      .set({ isActive, updatedAt: new Date().toISOString() })
      .where(and(eq(users.id, targetUserId), eq(users.organizationId, actor.organizationId)));

    if (!isActive) {
      await tx.delete(sessions).where(and(eq(sessions.userId, targetUserId), eq(sessions.organizationId, actor.organizationId)));
    }

    await tx.insert(auditLogs).values({
      id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id,
      action: isActive ? 'organization_member_activated' : 'organization_member_deactivated',
      entityType: 'user', entityId: targetUserId,
    });
  });
}

export async function setMemberRoleInTransaction(
  actor: CurrentUser,
  targetUserId: string,
  role: 'admin' | 'hr' | 'employee',
): Promise<void> {
  assertTargetMember(actor, targetUserId);
  if (!['admin', 'hr', 'employee'].includes(role)) throw new Error('Invalid organization role.');
  if (targetUserId === actor.id) throw new Error('You cannot change your own role from member management.');

  await db.transaction(async (tx) => {
    await setTenantContext(tx, actor.organizationId);
    const targetRows = await tx
      .select({ id: users.id, role: users.role, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.organizationId, actor.organizationId)))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new Error('Member not found in your organization.');
    if (target.role === role) return;

    if (target.role === 'admin' && role !== 'admin' && target.isActive) {
      const admins = await tx
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.organizationId, actor.organizationId), eq(users.role, 'admin'), eq(users.isActive, true)));
      if (Number(admins[0]?.count ?? 0) <= 1) {
        throw new Error('The organization must retain at least one active administrator.');
      }
    }

    await tx.update(users).set({ role, updatedAt: new Date().toISOString() }).where(
      and(eq(users.id, targetUserId), eq(users.organizationId, actor.organizationId)),
    );
    await tx.insert(auditLogs).values({
      id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id,
      action: 'organization_member_role_changed', entityType: 'user', entityId: targetUserId,
      metadata: JSON.stringify({ role }),
    });
  });
}

export async function linkEmployeeToMemberInTransaction(
  actor: CurrentUser,
  targetUserId: string,
  employeeId: string | null,
): Promise<void> {
  assertTargetMember(actor, targetUserId);

  await db.transaction(async (tx) => {
    await setTenantContext(tx, actor.organizationId);
    const target = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, targetUserId), eq(users.organizationId, actor.organizationId)))
      .limit(1);
    if (!target[0]) throw new Error('Member not found in your organization.');

    if (employeeId) {
      const employee = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)))
        .limit(1);
      if (!employee[0]) throw new Error('Employee not found in your organization.');

      const linked = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.employeeId, employeeId),
          eq(users.organizationId, actor.organizationId),
          sql`${users.id} <> ${targetUserId}`,
        ))
        .limit(1);
      if (linked[0]) throw new Error('That employee is already linked to another organization member.');
    }

    await tx.update(users).set({ employeeId, updatedAt: new Date().toISOString() }).where(
      and(eq(users.id, targetUserId), eq(users.organizationId, actor.organizationId)),
    );
    await tx.insert(auditLogs).values({
      id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id,
      action: 'organization_member_employee_link_changed', entityType: 'user', entityId: targetUserId,
      metadata: JSON.stringify({ employeeId }),
    });
  });
}

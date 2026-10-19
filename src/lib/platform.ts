import { nanoid } from 'nanoid';
import { db, setTenantContext } from '@/db/client';
import { auditLogs, organizations, organizationSettings, platformAdministrators, platformAuditLogs, recruitmentStages, sessions, users } from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { hashPassword } from './password';
import { ForbiddenError } from './auth';
import type { CurrentUser } from './session';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const DATE_FORMATS = new Set(['YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY']);
const COMMON_TIMEZONES = new Set(['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney']);
const DEFAULT_STAGES = [
  ['applied', 'Applied', 0], ['screening', 'Screening', 1], ['shortlisted', 'Shortlisted', 2],
  ['interview', 'Interview', 3], ['evaluation', 'Evaluation', 4], ['offer', 'Offer', 5],
  ['hired', 'Hired', 6], ['rejected', 'Rejected', 7], ['withdrawn', 'Withdrawn', 8], ['archived', 'Archived', 9],
] as const;

export type ProvisionOrganizationInput = { name: string; slug: string; adminEmail: string; adminPassword: string };
export type OrganizationConfigInput = { timezone: string; locale: string; dateFormat: string; weekStartDay: number };

export function validateProvisioningInput(input: ProvisionOrganizationInput): string | null {
  const name = input.name.trim(); const slug = input.slug.trim().toLowerCase(); const email = input.adminEmail.trim().toLowerCase();
  if (name.length < 2 || name.length > 100) return 'Organization name must be between 2 and 100 characters.';
  if (slug.length < 3 || slug.length > 64 || !SLUG_PATTERN.test(slug)) return 'Slug must be 3–64 characters and contain only lowercase letters, numbers, and single hyphens.';
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return 'Enter a valid administrator email address.';
  if (input.adminPassword.length < 12 || input.adminPassword.length > 256) return 'Initial administrator password must be 12–256 characters.';
  return null;
}

export function validateOrganizationConfig(input: OrganizationConfigInput): string | null {
  if (!COMMON_TIMEZONES.has(input.timezone)) return 'Unsupported timezone. Choose one of the supported organization timezones.';
  if (!LOCALE_PATTERN.test(input.locale)) return 'Locale must use a supported language or language-region format.';
  if (!DATE_FORMATS.has(input.dateFormat)) return 'Unsupported date format.';
  if (!Number.isInteger(input.weekStartDay) || input.weekStartDay < 0 || input.weekStartDay > 6) return 'Week start day must be between 0 and 6.';
  return null;
}

export async function isPlatformAdministrator(userId: string): Promise<boolean> {
  const rows = await db.select({ userId: platformAdministrators.userId }).from(platformAdministrators).where(eq(platformAdministrators.userId, userId)).limit(1);
  return rows.length === 1;
}

export async function assertPlatformAdministrator(userId: string): Promise<void> {
  if (!(await isPlatformAdministrator(userId))) throw new ForbiddenError('Platform administration access is restricted.');
}

export async function recordPlatformAudit(params: { actorUserId: string | null; action: string; entityType: string; entityId: string; metadata?: Record<string, unknown> }): Promise<void> {
  await db.insert(platformAuditLogs).values({ id: nanoid(), actorUserId: params.actorUserId, action: params.action, entityType: params.entityType, entityId: params.entityId, metadata: params.metadata ? JSON.stringify(params.metadata) : null });
}

export async function getPlatformOverview() {
  const [organizationsRows, userCountRows, auditRows] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status, createdAt: organizations.createdAt, updatedAt: organizations.updatedAt }).from(organizations).orderBy(desc(organizations.createdAt)),
    db.select({ organizationId: users.organizationId }).from(users),
    db.select({ id: platformAuditLogs.id, actorUserId: platformAuditLogs.actorUserId, action: platformAuditLogs.action, entityType: platformAuditLogs.entityType, entityId: platformAuditLogs.entityId, metadata: platformAuditLogs.metadata, createdAt: platformAuditLogs.createdAt }).from(platformAuditLogs).orderBy(desc(platformAuditLogs.createdAt)).limit(50),
  ]);
  const counts = new Map<string, number>();
  for (const row of userCountRows) counts.set(row.organizationId, (counts.get(row.organizationId) ?? 0) + 1);
  return { organizations: organizationsRows.map((org) => ({ ...org, userCount: counts.get(org.id) ?? 0 })), audit: auditRows };
}

export async function getOrganizationConfiguration(user: CurrentUser) {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, user.organizationId);
    const rows = await tx.select().from(organizationSettings).where(eq(organizationSettings.organizationId, user.organizationId)).limit(1);
    return rows[0] ?? null;
  });
}

export async function updateOrganizationConfigurationInTransaction(actor: CurrentUser, input: OrganizationConfigInput): Promise<void> {
  if (actor.role !== 'admin') throw new ForbiddenError('Only organization administrators can change organization configuration.');
  const error = validateOrganizationConfig(input); if (error) throw new Error(error);

  await db.transaction(async (tx) => {
    await setTenantContext(tx, actor.organizationId);
    const existing = await tx.select({ organizationId: organizationSettings.organizationId }).from(organizationSettings).where(eq(organizationSettings.organizationId, actor.organizationId)).limit(1);
    if (!existing[0]) throw new Error('Organization configuration is not initialized.');
    await tx.update(organizationSettings).set({ timezone: input.timezone, locale: input.locale, dateFormat: input.dateFormat, weekStartDay: input.weekStartDay, updatedAt: new Date().toISOString() }).where(eq(organizationSettings.organizationId, actor.organizationId));
    await tx.insert(auditLogs).values({ id: nanoid(), organizationId: actor.organizationId, actorUserId: actor.id, action: 'organization_configuration_changed', entityType: 'organization_settings', entityId: actor.organizationId, metadata: JSON.stringify({ changedFields: ['timezone', 'locale', 'dateFormat', 'weekStartDay'] }) });
  });
}

export async function provisionOrganizationInTransaction(actor: CurrentUser, input: ProvisionOrganizationInput, failureHook?: () => void): Promise<{ organizationId: string; adminUserId: string; slug: string }> {
  await assertPlatformAdministrator(actor.id);
  const error = validateProvisioningInput(input); if (error) throw new Error(error);
  const name = input.name.trim(); const slug = input.slug.trim().toLowerCase(); const email = input.adminEmail.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const existingSlug = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1); if (existingSlug[0]) throw new Error('That organization slug is already in use.');
    const existingEmail = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1); if (existingEmail[0]) throw new Error('That administrator email is already registered.');
    const organizationId = `org_${nanoid(16)}`; const adminUserId = `usr_${nanoid(16)}`; const { hash, salt } = hashPassword(input.adminPassword);
    await tx.insert(organizations).values({ id: organizationId, name, slug, status: 'active' });
    await tx.insert(organizationSettings).values({ organizationId });
    await tx.insert(users).values({ id: adminUserId, organizationId, email, passwordHash: hash, passwordSalt: salt, role: 'admin', isActive: true });
    for (const [statusKey, stageName, position] of DEFAULT_STAGES) {
      await tx.insert(recruitmentStages).values({ id: `${organizationId}:${statusKey}`, organizationId, statusKey, name: stageName, position, isActive: true, createdBy: adminUserId, updatedBy: adminUserId }).onConflictDoNothing();
    }
    failureHook?.();
    await tx.insert(platformAuditLogs).values({ id: nanoid(), actorUserId: actor.id, action: 'organization_provisioned', entityType: 'organization', entityId: organizationId, metadata: JSON.stringify({ slug, initialAdministratorUserId: adminUserId, initialAdministratorEmail: email }) });
    await tx.insert(platformAuditLogs).values({ id: nanoid(), actorUserId: actor.id, action: 'initial_administrator_provisioned', entityType: 'user', entityId: adminUserId, metadata: JSON.stringify({ organizationId, email }) });
    return { organizationId, adminUserId, slug };
  });
}

export async function setOrganizationStatusInTransaction(actor: CurrentUser, organizationId: string, status: 'active' | 'suspended'): Promise<void> {
  await assertPlatformAdministrator(actor.id);
  if (!organizationId) throw new Error('Organization identifier is required.');
  if (organizationId === actor.organizationId && status === 'suspended') throw new Error('You cannot suspend the organization that owns your current account.');

  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: organizations.id, status: organizations.status }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const org = rows[0]; if (!org) throw new Error('Organization not found.'); if (org.status === status) return;
    await tx.update(organizations).set({ status, updatedAt: new Date().toISOString() }).where(eq(organizations.id, organizationId));
    if (status === 'suspended') await tx.delete(sessions).where(eq(sessions.organizationId, organizationId));
    await tx.insert(platformAuditLogs).values({ id: nanoid(), actorUserId: actor.id, action: status === 'suspended' ? 'organization_suspended' : 'organization_reactivated', entityType: 'organization', entityId: organizationId, metadata: JSON.stringify({ previousStatus: org.status, newStatus: status }) });
  });
}

export async function getPlatformAdministrators() {
  return db.select({ userId: platformAdministrators.userId, createdAt: platformAdministrators.createdAt, email: users.email, organizationId: users.organizationId, role: users.role, isActive: users.isActive }).from(platformAdministrators).innerJoin(users, eq(platformAdministrators.userId, users.id)).orderBy(desc(platformAdministrators.createdAt));
}

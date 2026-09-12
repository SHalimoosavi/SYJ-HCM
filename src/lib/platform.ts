import { nanoid } from 'nanoid';
import { db, sqlite, withSqliteTransactionSync } from '@/db/client';
import { organizations, organizationSettings, platformAdministrators, platformAuditLogs, users } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { recordAuditSync } from './audit';
import { hashPassword } from './password';
import { ForbiddenError } from './auth';
import type { CurrentUser } from './session';
import { provisionDefaultRecruitmentStagesSync } from './recruitment-workflow';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const DATE_FORMATS = new Set(['YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY']);
const COMMON_TIMEZONES = new Set(['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney']);

export type ProvisionOrganizationInput = {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
};

export type OrganizationConfigInput = {
  timezone: string;
  locale: string;
  dateFormat: string;
  weekStartDay: number;
};

export function validateProvisioningInput(input: ProvisionOrganizationInput): string | null {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const email = input.adminEmail.trim().toLowerCase();
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

export function assertPlatformAdministratorSync(userId: string): void {
  const row = sqlite.prepare('SELECT user_id FROM platform_administrators WHERE user_id = ? LIMIT 1').get(userId) as { user_id?: string } | undefined;
  if (!row?.user_id) throw new ForbiddenError('Platform administration access is restricted.');
}

export function recordPlatformAuditSync(params: { actorUserId: string | null; action: string; entityType: string; entityId: string; metadata?: Record<string, unknown> }): void {
  sqlite.prepare(`INSERT INTO platform_audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?, ?)`).run(
    nanoid(), params.actorUserId, params.action, params.entityType, params.entityId, params.metadata ? JSON.stringify(params.metadata) : null
  );
}

export async function getPlatformOverview() {
  const [organizationsRows, userCountRows, auditRows] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status, createdAt: organizations.createdAt, updatedAt: organizations.updatedAt }).from(organizations).orderBy(desc(organizations.createdAt)),
    db.select({ organizationId: users.organizationId }).from(users),
    db.select({ id: platformAuditLogs.id, actorUserId: platformAuditLogs.actorUserId, action: platformAuditLogs.action, entityType: platformAuditLogs.entityType, entityId: platformAuditLogs.entityId, metadata: platformAuditLogs.metadata, createdAt: platformAuditLogs.createdAt }).from(platformAuditLogs).orderBy(desc(platformAuditLogs.createdAt)).limit(50)
  ]);
  const counts = new Map<string, number>();
  for (const row of userCountRows) counts.set(row.organizationId, (counts.get(row.organizationId) ?? 0) + 1);
  return { organizations: organizationsRows.map((org) => ({ ...org, userCount: counts.get(org.id) ?? 0 })), audit: auditRows };
}

export async function getOrganizationConfiguration(user: CurrentUser) {
  const rows = await db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, user.organizationId)).limit(1);
  return rows[0] ?? null;
}

export function updateOrganizationConfigurationInTransaction(actor: CurrentUser, input: OrganizationConfigInput): void {
  if (actor.role !== 'admin') throw new ForbiddenError('Only organization administrators can change organization configuration.');
  const error = validateOrganizationConfig(input);
  if (error) throw new Error(error);
  withSqliteTransactionSync(() => {
    const existing = sqlite.prepare('SELECT organization_id FROM organization_settings WHERE organization_id = ? LIMIT 1').get(actor.organizationId) as { organization_id?: string } | undefined;
    if (!existing?.organization_id) throw new Error('Organization configuration is not initialized.');
    sqlite.prepare(`UPDATE organization_settings SET timezone = ?, locale = ?, date_format = ?, week_start_day = ?, updated_at = current_timestamp WHERE organization_id = ?`).run(input.timezone, input.locale, input.dateFormat, input.weekStartDay, actor.organizationId);
    recordAuditSync({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'organization_configuration_changed', entityType: 'organization_settings', entityId: actor.organizationId, metadata: { changedFields: ['timezone', 'locale', 'dateFormat', 'weekStartDay'] } });
  });
}

export function provisionOrganizationInTransaction(actor: CurrentUser, input: ProvisionOrganizationInput, failureHook?: () => void): { organizationId: string; adminUserId: string; slug: string } {
  assertPlatformAdministratorSync(actor.id);
  const error = validateProvisioningInput(input);
  if (error) throw new Error(error);
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const email = input.adminEmail.trim().toLowerCase();
  const existingSlug = sqlite.prepare('SELECT id FROM organizations WHERE slug = ? LIMIT 1').get(slug) as { id?: string } | undefined;
  if (existingSlug?.id) throw new Error('That organization slug is already in use.');
  const existingEmail = sqlite.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').get(email) as { id?: string } | undefined;
  if (existingEmail?.id) throw new Error('That administrator email is already registered.');

  return withSqliteTransactionSync(() => {
    const organizationId = `org_${nanoid(16)}`;
    const adminUserId = `usr_${nanoid(16)}`;
    const { hash, salt } = hashPassword(input.adminPassword);
    sqlite.prepare('INSERT INTO organizations (id, name, slug, status) VALUES (?, ?, ?, \'active\')').run(organizationId, name, slug);
    sqlite.prepare('INSERT INTO organization_settings (organization_id) VALUES (?)').run(organizationId);
    sqlite.prepare(`INSERT INTO users (id, organization_id, email, password_hash, password_salt, role, is_active) VALUES (?, ?, ?, ?, ?, 'admin', 1)`).run(adminUserId, organizationId, email, hash, salt);
    provisionDefaultRecruitmentStagesSync(organizationId, adminUserId);
    failureHook?.();
    recordPlatformAuditSync({ actorUserId: actor.id, action: 'organization_provisioned', entityType: 'organization', entityId: organizationId, metadata: { slug, initialAdministratorUserId: adminUserId, initialAdministratorEmail: email } });
    recordPlatformAuditSync({ actorUserId: actor.id, action: 'initial_administrator_provisioned', entityType: 'user', entityId: adminUserId, metadata: { organizationId, email } });
    return { organizationId, adminUserId, slug };
  });
}

export function setOrganizationStatusInTransaction(actor: CurrentUser, organizationId: string, status: 'active' | 'suspended'): void {
  assertPlatformAdministratorSync(actor.id);
  if (!organizationId) throw new Error('Organization identifier is required.');
  if (organizationId === actor.organizationId && status === 'suspended') throw new Error('You cannot suspend the organization that owns your current account.');
  withSqliteTransactionSync(() => {
    const org = sqlite.prepare('SELECT id, status FROM organizations WHERE id = ? LIMIT 1').get(organizationId) as { id?: string; status?: string } | undefined;
    if (!org?.id) throw new Error('Organization not found.');
    if (org.status === status) return;
    sqlite.prepare('UPDATE organizations SET status = ?, updated_at = current_timestamp WHERE id = ?').run(status, organizationId);
    if (status === 'suspended') sqlite.prepare('DELETE FROM sessions WHERE organization_id = ?').run(organizationId);
    recordPlatformAuditSync({ actorUserId: actor.id, action: status === 'suspended' ? 'organization_suspended' : 'organization_reactivated', entityType: 'organization', entityId: organizationId, metadata: { previousStatus: org.status, newStatus: status } });
  });
}

export async function getPlatformAdministrators() {
  return db.select({ userId: platformAdministrators.userId, createdAt: platformAdministrators.createdAt, email: users.email, organizationId: users.organizationId, role: users.role, isActive: users.isActive }).from(platformAdministrators).innerJoin(users, eq(platformAdministrators.userId, users.id)).orderBy(desc(platformAdministrators.createdAt));
}

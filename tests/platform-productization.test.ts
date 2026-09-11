import './helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, sqlite } from '../src/db/client';
import { organizations, organizationSettings, platformAdministrators, platformAuditLogs, sessions, users, auditLogs } from '../src/db/schema';
import { nanoid } from 'nanoid';
import { verifyPassword } from '../src/lib/password';
import type { CurrentUser } from '../src/lib/session';
import { ForbiddenError } from '../src/lib/auth';
import { assertPlatformAdministratorSync, provisionOrganizationInTransaction, setOrganizationStatusInTransaction, updateOrganizationConfigurationInTransaction, validateOrganizationConfig, validateProvisioningInput } from '../src/lib/platform';

const admin: CurrentUser = { id: 'platform-owner', email: 'platform@example.test', role: 'admin', employeeId: null, organizationId: 'org_default', organizationStatus: 'active' };
const hr: CurrentUser = { ...admin, id: 'hr-user', email: 'hr@example.test', role: 'hr' };
const employee: CurrentUser = { ...admin, id: 'employee-user', email: 'employee@example.test', role: 'employee' };

async function resetFixture() {
  sqlite.exec('DELETE FROM sessions; DELETE FROM organization_settings; DELETE FROM platform_administrators;');
  sqlite.exec("UPDATE organizations SET name='Default Organization', slug='default', status='active', updated_at=current_timestamp WHERE id='org_default';");
  sqlite.exec("INSERT OR IGNORE INTO users (id, organization_id, email, password_hash, password_salt, role, is_active) VALUES ('platform-owner','org_default','platform@example.test','x','x','admin',1), ('hr-user','org_default','hr@example.test','x','x','hr',1), ('employee-user','org_default','employee@example.test','x','x','employee',1);");
  sqlite.exec("INSERT OR IGNORE INTO organization_settings (organization_id) VALUES ('org_default');");
  sqlite.exec("INSERT OR IGNORE INTO platform_administrators (user_id) VALUES ('platform-owner');");
  sqlite.exec("INSERT OR IGNORE INTO organizations (id,name,slug,status) VALUES ('org_b','Organization B','organization-b','active');");
  sqlite.exec("INSERT OR IGNORE INTO organization_settings (organization_id) VALUES ('org_b');");
}

test.beforeEach(resetFixture);

test('platform capability is separate from organization roles', async () => {
  assert.equal(await (await import('../src/lib/platform')).isPlatformAdministrator(admin.id), true);
  assert.equal(await (await import('../src/lib/platform')).isPlatformAdministrator(hr.id), false);
  assert.equal(await (await import('../src/lib/platform')).isPlatformAdministrator(employee.id), false);
  assert.throws(() => assertPlatformAdministratorSync(hr.id), ForbiddenError);
  assert.throws(() => assertPlatformAdministratorSync(employee.id), ForbiddenError);
});

test('valid provisioning creates one organization, defaults, and initial admin atomically', () => {
  const result = provisionOrganizationInTransaction(admin, { name: 'New Customer', slug: 'new-customer', adminEmail: 'owner@new-customer.test', adminPassword: 'StrongInitialPassword123!' });
  assert.ok(result.organizationId.startsWith('org_'));
  assert.ok(result.adminUserId.startsWith('usr_'));
  const org = sqlite.prepare('SELECT name, slug, status FROM organizations WHERE id = ?').get(result.organizationId) as any;
  const config = sqlite.prepare('SELECT organization_id, timezone, locale FROM organization_settings WHERE organization_id = ?').get(result.organizationId) as any;
  const user = sqlite.prepare('SELECT organization_id, role, is_active, password_hash, password_salt FROM users WHERE id = ?').get(result.adminUserId) as any;
  assert.equal(org.slug, 'new-customer'); assert.equal(org.status, 'active');
  assert.equal(config.organization_id, result.organizationId); assert.equal(config.timezone, 'UTC');
  assert.equal(user.organization_id, result.organizationId); assert.equal(user.role, 'admin'); assert.equal(user.is_active, 1);
  assert.equal(verifyPassword('StrongInitialPassword123!', user.password_hash, user.password_salt), true);
  const audits = Number(sqlite.prepare("SELECT COUNT(*) c FROM platform_audit_logs WHERE entity_id IN (?, ?)").get(result.organizationId, result.adminUserId)?.c ?? 0);
  assert.equal(audits, 2);
});

test('provisioning rejects duplicate slug and duplicate account identity', () => {
  assert.throws(() => provisionOrganizationInTransaction(admin, { name: 'Duplicate', slug: 'organization-b', adminEmail: 'new@example.test', adminPassword: 'StrongInitialPassword123!' }), /slug is already/);
  assert.throws(() => provisionOrganizationInTransaction(admin, { name: 'Duplicate', slug: 'new-unique-slug', adminEmail: 'platform@example.test', adminPassword: 'StrongInitialPassword123!' }), /email is already/);
});

test('provisioning rolls back all tenant records on a deliberate required-step failure', () => {
  assert.throws(() => provisionOrganizationInTransaction(admin, { name: 'Rollback Tenant', slug: 'rollback-tenant', adminEmail: 'rollback@example.test', adminPassword: 'StrongInitialPassword123!' }, () => { throw new Error('deliberate provisioning failure'); }), /deliberate provisioning failure/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM organizations WHERE id='org_rollback'").get()?.c, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM users WHERE id='usr_rollback'").get()?.c, 0);
});

test('suspension revokes tenant sessions, blocks tenant context, and preserves data for recovery', () => {
  sqlite.prepare("INSERT INTO users (id,organization_id,email,password_hash,password_salt,role,is_active) VALUES ('b-admin','org_b','b-admin@example.test','x','x','admin',1)").run();
  sqlite.prepare("INSERT INTO sessions (id,organization_id,user_id,expires_at,last_active_at) VALUES ('b-session','org_b','b-admin','2099-01-01','2026-01-01')").run();
  setOrganizationStatusInTransaction(admin, 'org_b', 'suspended');
  assert.equal(sqlite.prepare("SELECT status FROM organizations WHERE id='org_b'").get()?.status, 'suspended');
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM sessions WHERE organization_id='org_b'").get()?.c, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM organization_settings WHERE organization_id='org_b'").get()?.c, 1);
  assert.throws(() => setOrganizationStatusInTransaction(hr, 'org_b', 'active'), /Platform administration/);
  setOrganizationStatusInTransaction(admin, 'org_b', 'active');
  assert.equal(sqlite.prepare("SELECT status FROM organizations WHERE id='org_b'").get()?.status, 'active');
  const auditCount = Number(sqlite.prepare("SELECT COUNT(*) c FROM platform_audit_logs WHERE entity_id='org_b'").get()?.c ?? 0);
  assert.equal(auditCount, 2);
});

test('platform cannot suspend the organization containing its current account', () => {
  assert.throws(() => setOrganizationStatusInTransaction(admin, admin.organizationId, 'suspended'), /cannot suspend/);
});

test('organization configuration is tenant-scoped, validated, and audited', () => {
  const actor = admin;
  updateOrganizationConfigurationInTransaction(actor, { timezone: 'Asia/Kolkata', locale: 'en-IN', dateFormat: 'DD-MM-YYYY', weekStartDay: 1 });
  const cfg = sqlite.prepare("SELECT timezone,date_format FROM organization_settings WHERE organization_id='org_default'").get() as any;
  assert.equal(cfg.timezone, 'Asia/Kolkata'); assert.equal(cfg.date_format, 'DD-MM-YYYY');
  assert.equal(sqlite.prepare("SELECT timezone FROM organization_settings WHERE organization_id='org_b'").get()?.timezone, 'UTC');
  assert.equal(sqlite.prepare("SELECT action FROM audit_logs WHERE entity_type='organization_settings' AND entity_id='org_default' ORDER BY rowid DESC LIMIT 1").get()?.action, 'organization_configuration_changed');
  assert.match(validateOrganizationConfig({ timezone: 'Mars/Colony', locale: 'en-IN', dateFormat: 'YYYY-MM-DD', weekStartDay: 1 }) ?? '', /Unsupported timezone/);
  assert.match(validateOrganizationConfig({ timezone: 'UTC', locale: 'bad_locale', dateFormat: 'YYYY-MM-DD', weekStartDay: 1 }) ?? '', /Locale/);
});

test('platform and tenant audit logs remain immutable', () => {
  assert.throws(() => sqlite.prepare("UPDATE platform_audit_logs SET action='tampered'").run(), /immutable/);
  assert.throws(() => sqlite.prepare("DELETE FROM platform_audit_logs").run(), /immutable/);
  sqlite.prepare("INSERT INTO audit_logs (id,organization_id,actor_user_id,action,entity_type,entity_id) VALUES ('tenant-audit','org_default','platform-owner','test','organization','org_default')").run();
  assert.throws(() => sqlite.prepare("DELETE FROM audit_logs WHERE id='tenant-audit'").run(), /immutable/);
});

test('validation rejects unsafe provisioning input', () => {
  assert.equal(validateProvisioningInput({ name: 'Valid', slug: 'valid-org', adminEmail: 'owner@example.test', adminPassword: 'StrongInitialPassword123!' }), null);
  assert.match(validateProvisioningInput({ name: 'x', slug: 'valid-org', adminEmail: 'owner@example.test', adminPassword: 'StrongInitialPassword123!' }) ?? '', /between 2/);
  assert.match(validateProvisioningInput({ name: 'Valid', slug: 'bad slug', adminEmail: 'owner@example.test', adminPassword: 'StrongInitialPassword123!' }) ?? '', /lowercase/);
  assert.match(validateProvisioningInput({ name: 'Valid', slug: 'valid-org', adminEmail: 'owner@example.test', adminPassword: 'short' }) ?? '', /12/);
});

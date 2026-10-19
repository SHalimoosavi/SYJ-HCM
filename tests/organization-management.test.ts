import './helpers/setup-test-db';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import {
  getOrganizationForAdmin,
  getOrganizationMembersForAdmin,
  linkEmployeeToMemberInTransaction,
  setMemberRoleInTransaction,
  setMemberStatusInTransaction,
  updateOrganizationInTransaction,
  validateOrganizationDetails,
} from '../src/lib/organization-management';
import { canManageOrganization } from '../src/lib/authorization';
import type { CurrentUser } from '../src/lib/session';

const admin: CurrentUser = { id: 'admin-a', email: 'admin-a@example.test', role: 'admin', employeeId: null, organizationId: 'org_default', organizationStatus: 'active' };
const hr: CurrentUser = { id: 'hr-a', email: 'hr-a@example.test', role: 'hr', employeeId: null, organizationId: 'org_default', organizationStatus: 'active' };
const otherAdmin: CurrentUser = { id: 'admin-b', email: 'admin-b@example.test', role: 'admin', employeeId: null, organizationId: 'org_b', organizationStatus: 'active' };

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl) throw new Error('DATABASE_MIGRATION_URL is required for PostgreSQL test setup.');
const setupDb = postgres(migrationUrl, { max: 1 });

beforeEach(async () => {
  await setupDb.begin(async (tx) => {
    await tx.unsafe('DELETE FROM sessions');
    await tx.unsafe('DELETE FROM employees');
    await tx.unsafe('DELETE FROM departments');
    // Users are retained because audit_logs.actor_user_id is intentionally
    // immutable. Hard-deleting a referenced actor would invoke ON DELETE SET
    // NULL and violate the audit immutability trigger. Reset the fixture user
    // in-place instead.
    await tx.unsafe("UPDATE users SET organization_id = 'org_default', email = 'admin-a2@example.test', password_hash = 'x', password_salt = 'x', role = 'admin', is_active = true, employee_id = NULL WHERE id = 'admin-a2'");
    await tx.unsafe("UPDATE organizations SET name = 'Default Organization', slug = 'default', status = 'active', updated_at = now() WHERE id = 'org_default'");
    await tx.unsafe("INSERT INTO organizations (id, name, slug, status) VALUES ('org_b', 'Organization B', 'organization-b', 'active') ON CONFLICT (id) DO UPDATE SET name=excluded.name, slug=excluded.slug, status=excluded.status");
    await tx.unsafe("UPDATE users SET organization_id = CASE id WHEN 'admin-b' THEN 'org_b' ELSE 'org_default' END, email = CASE id WHEN 'admin-a' THEN 'admin-a@example.test' WHEN 'hr-a' THEN 'hr-a@example.test' WHEN 'employee-a' THEN 'employee-a@example.test' WHEN 'admin-b' THEN 'admin-b@example.test' END, password_hash = 'x', password_salt = 'x', role = CASE id WHEN 'admin-a' THEN 'admin' WHEN 'hr-a' THEN 'hr' WHEN 'employee-a' THEN 'employee' WHEN 'admin-b' THEN 'admin' END, is_active = true, employee_id = NULL WHERE id IN ('admin-a','hr-a','employee-a','admin-b')");
    await tx.unsafe("INSERT INTO users (id, organization_id, email, password_hash, password_salt, role, is_active) VALUES ('admin-a','org_default','admin-a@example.test','x','x','admin',true),('hr-a','org_default','hr-a@example.test','x','x','hr',true),('employee-a','org_default','employee-a@example.test','x','x','employee',true),('admin-b','org_b','admin-b@example.test','x','x','admin',true) ON CONFLICT (id) DO NOTHING");
    await tx.unsafe("INSERT INTO employees (id, organization_id, employee_code, first_name, last_name, work_email, date_of_joining, designation) VALUES ('emp-a','org_default','E-001','Alice','Admin','alice@example.test','2026-01-01','Engineer'),('emp-b','org_b','E-001','Bob','Admin','bob@example.test','2026-01-01','Engineer') ON CONFLICT (id) DO UPDATE SET organization_id=excluded.organization_id, employee_code=excluded.employee_code, first_name=excluded.first_name, last_name=excluded.last_name, work_email=excluded.work_email, date_of_joining=excluded.date_of_joining, designation=excluded.designation");
  });
});

test.after(async () => { await setupDb.end({ timeout: 5 }); });

test('organization admin can access only own organization', async () => {
  const organization = await getOrganizationForAdmin(admin);
  assert.equal(organization?.id, 'org_default');
  const members = await getOrganizationMembersForAdmin(admin);
  assert.equal(members.length, 3);
  assert.equal(members.some((member) => member.id === 'admin-b'), false);
});

test('only admin role can manage organization', async () => {
  assert.equal(canManageOrganization('admin'), true);
  assert.equal(canManageOrganization('hr'), false);
  assert.equal(canManageOrganization('employee'), false);
  await assert.rejects(() => getOrganizationForAdmin(hr), /Only organization administrators/);
});

test('organization validation enforces safe identity values', () => {
  assert.equal(validateOrganizationDetails({ name: 'Sayanjali Nexus', slug: 'sayanjali-nexus' }), null);
  assert.match(validateOrganizationDetails({ name: 'x', slug: 'bad slug' }) ?? '', /between 2 and 100/);
  assert.match(validateOrganizationDetails({ name: 'Valid Name', slug: 'Bad_Slug' }) ?? '', /lowercase/);
});

test('organization slug uniqueness and tenant scoping are enforced', async () => {
  await assert.rejects(() => updateOrganizationInTransaction(admin, { name: 'Changed', slug: 'organization-b' }), /already in use/);
  await updateOrganizationInTransaction(admin, { name: 'Changed', slug: 'changed-org' });
  const rows = await setupDb`SELECT name, slug FROM organizations WHERE id='org_default'`;
  const other = await setupDb`SELECT name, slug FROM organizations WHERE id='org_b'`;
  assert.equal(rows[0]?.name, 'Changed'); assert.equal(rows[0]?.slug, 'changed-org');
  assert.equal(other[0]?.name, 'Organization B'); assert.equal(other[0]?.slug, 'organization-b');
});

test('member status changes cannot cross tenant boundary and revoke sessions', async () => {
  await setupDb`INSERT INTO sessions (id,organization_id,user_id,expires_at,last_active_at) VALUES ('session-a','org_default','employee-a','2030-01-01T00:00:00.000Z','2026-09-10T00:00:00.000Z')`;
  await assert.rejects(() => setMemberStatusInTransaction(admin, 'admin-b', false), /not found in your organization/);
  await setMemberStatusInTransaction(admin, 'employee-a', false);
  const userRows = await setupDb`SELECT is_active FROM users WHERE id='employee-a'`;
  const sessionRows = await setupDb`SELECT count(*)::int AS count FROM sessions WHERE user_id='employee-a'`;
  assert.equal(userRows[0]?.is_active, false);
  assert.equal(sessionRows[0]?.count, 0);
});

test('administrator lockout protections preserve an active admin', async () => {
  await assert.rejects(() => setMemberStatusInTransaction(admin, 'admin-a', false), /cannot deactivate/);
  await assert.rejects(() => setMemberRoleInTransaction(admin, 'admin-a', 'hr'), /cannot change your own role/);
  await setupDb`INSERT INTO users (id,organization_id,email,password_hash,password_salt,role,is_active) VALUES ('admin-a2','org_default','admin-a2@example.test','x','x','admin',true) ON CONFLICT (id) DO UPDATE SET organization_id=excluded.organization_id,email=excluded.email,password_hash='x',password_salt='x',role='admin',is_active=true,employee_id=NULL`;
  await setMemberRoleInTransaction(admin, 'admin-a2', 'hr');
  const rows = await setupDb`SELECT role FROM users WHERE id='admin-a2'`;
  assert.equal(rows[0]?.role, 'hr');
  const admin2 = { ...admin, id: 'admin-b', organizationId: 'org_b' } as CurrentUser;
  await assert.rejects(() => setMemberRoleInTransaction(admin2, 'admin-a', 'hr'), /not found in your organization/);
});

test('role changes are tenant-scoped and audited', async () => {
  await setMemberRoleInTransaction(admin, 'hr-a', 'employee');
  const userRows = await setupDb`SELECT role FROM users WHERE id='hr-a'`;
  const auditRows = await setupDb`SELECT action FROM audit_logs WHERE entity_id='hr-a' ORDER BY created_at DESC LIMIT 1`;
  assert.equal(userRows[0]?.role, 'employee');
  assert.equal(auditRows[0]?.action, 'organization_member_role_changed');
  await assert.rejects(() => setMemberRoleInTransaction(otherAdmin, 'admin-a', 'employee'), /not found in your organization/);
});

test('employee linking stays inside the authenticated organization', async () => {
  await linkEmployeeToMemberInTransaction(admin, 'hr-a', 'emp-a');
  const rows = await setupDb`SELECT employee_id FROM users WHERE id='hr-a'`;
  assert.equal(rows[0]?.employee_id, 'emp-a');
  await assert.rejects(() => linkEmployeeToMemberInTransaction(admin, 'hr-a', 'emp-b'), /not found in your organization/);
  await assert.rejects(() => linkEmployeeToMemberInTransaction(otherAdmin, 'admin-b', 'emp-a'), /not found in your organization/);
});

test('organization mutation creates an audit record in the same tenant', async () => {
  await updateOrganizationInTransaction(admin, { name: 'Audited Organization', slug: 'audited-organization' });
  const audit = await setupDb`SELECT organization_id, actor_user_id, action FROM audit_logs WHERE entity_type='organization' AND entity_id='org_default' ORDER BY created_at DESC LIMIT 1`;
  assert.equal(audit[0]?.organization_id, 'org_default');
  assert.equal(audit[0]?.actor_user_id, 'admin-a');
  assert.equal(audit[0]?.action, 'organization_updated');
});
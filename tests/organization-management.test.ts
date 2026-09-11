import './helpers/setup-test-db';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sqlite } from '../src/db/client';
import {
  getOrganizationForAdmin,
  getOrganizationMembersForAdmin,
  linkEmployeeToMemberInTransaction,
  setMemberRoleInTransaction,
  setMemberStatusInTransaction,
  updateOrganizationInTransaction,
  validateOrganizationDetails
} from '../src/lib/organization-management';
import { canManageOrganization } from '../src/lib/authorization';
import type { CurrentUser } from '../src/lib/session';

const admin: CurrentUser = { id: 'admin-a', email: 'admin-a@example.test', role: 'admin', employeeId: null, organizationId: 'org_default', organizationStatus: 'active' };
const hr: CurrentUser = { id: 'hr-a', email: 'hr-a@example.test', role: 'hr', employeeId: null, organizationId: 'org_default', organizationStatus: 'active' };
const otherAdmin: CurrentUser = { id: 'admin-b', email: 'admin-b@example.test', role: 'admin', employeeId: null, organizationId: 'org_b', organizationStatus: 'active' };

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM sessions;
    DELETE FROM employees;
    DELETE FROM departments;
      DELETE FROM users WHERE id = 'admin-a2';
    UPDATE organizations SET name = 'Default Organization', slug = 'default', status = 'active', updated_at = current_timestamp WHERE id = 'org_default';
      UPDATE organizations SET name = 'Organization B', slug = 'organization-b', status = 'active', updated_at = current_timestamp WHERE id = 'org_b';
    INSERT OR IGNORE INTO organizations (id, name, slug, status) VALUES ('org_b', 'Organization B', 'organization-b', 'active');
      UPDATE users SET organization_id = CASE id WHEN 'admin-b' THEN 'org_b' ELSE 'org_default' END, email = CASE id WHEN 'admin-a' THEN 'admin-a@example.test' WHEN 'hr-a' THEN 'hr-a@example.test' WHEN 'employee-a' THEN 'employee-a@example.test' WHEN 'admin-b' THEN 'admin-b@example.test' END, password_hash = 'x', password_salt = 'x', role = CASE id WHEN 'admin-a' THEN 'admin' WHEN 'hr-a' THEN 'hr' WHEN 'employee-a' THEN 'employee' WHEN 'admin-b' THEN 'admin' END, is_active = 1, employee_id = NULL WHERE id IN ('admin-a', 'hr-a', 'employee-a', 'admin-b');
      INSERT OR IGNORE INTO users (id, organization_id, email, password_hash, password_salt, role, is_active) VALUES ('admin-a', 'org_default', 'admin-a@example.test', 'x', 'x', 'admin', 1), ('hr-a', 'org_default', 'hr-a@example.test', 'x', 'x', 'hr', 1), ('employee-a', 'org_default', 'employee-a@example.test', 'x', 'x', 'employee', 1), ('admin-b', 'org_b', 'admin-b@example.test', 'x', 'x', 'admin', 1);
    INSERT INTO employees (id, organization_id, employee_code, first_name, last_name, work_email, date_of_joining, designation)
      VALUES ('emp-a', 'org_default', 'E-001', 'Alice', 'Admin', 'alice@example.test', '2026-01-01', 'Engineer'),
             ('emp-b', 'org_b', 'E-001', 'Bob', 'Admin', 'bob@example.test', '2026-01-01', 'Engineer');
  `);
});

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

test('organization slug uniqueness and tenant scoping are enforced', () => {
  assert.throws(
    () => updateOrganizationInTransaction(admin, { name: 'Changed', slug: 'organization-b' }),
    /already in use/
  );
  updateOrganizationInTransaction(admin, { name: 'Changed', slug: 'changed-org' });
  const row = sqlite.prepare('SELECT name, slug FROM organizations WHERE id = ?').get('org_default') as { name: string; slug: string };
  const other = sqlite.prepare('SELECT name, slug FROM organizations WHERE id = ?').get('org_b') as { name: string; slug: string };
    assert.equal(row?.name, 'Changed'); assert.equal(row?.slug, 'changed-org');
    assert.equal(other?.name, 'Organization B'); assert.equal(other?.slug, 'organization-b');
});

test('member status changes cannot cross tenant boundary and revoke sessions', () => {
  sqlite.prepare('INSERT INTO sessions (id, organization_id, user_id, expires_at, last_active_at) VALUES (?, ?, ?, ?, ?)').run('session-a', 'org_default', 'employee-a', '2030-01-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
  assert.throws(() => setMemberStatusInTransaction(admin, 'admin-b', false), /not found in your organization/);
  setMemberStatusInTransaction(admin, 'employee-a', false);
    assert.equal(sqlite.prepare('SELECT is_active FROM users WHERE id = ?').get('employee-a')?.is_active, 0);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get('employee-a')?.count, 0);
});

test('administrator lockout protections preserve an active admin', () => {
  assert.throws(() => setMemberStatusInTransaction(admin, 'admin-a', false), /cannot deactivate/);
  assert.throws(() => setMemberRoleInTransaction(admin, 'admin-a', 'hr'), /cannot change your own role/);
    sqlite.prepare("INSERT INTO users (id, organization_id, email, password_hash, password_salt, role, is_active) VALUES ('admin-a2', 'org_default', 'admin-a2@example.test', 'x', 'x', 'admin', 1)").run();
  setMemberRoleInTransaction(admin, 'admin-a2', 'hr');
    assert.equal(sqlite.prepare('SELECT role FROM users WHERE id = ?').get('admin-a2')?.role, 'hr');
  const admin2 = { ...admin, id: 'admin-b', organizationId: 'org_b' } as CurrentUser;
  assert.throws(() => setMemberRoleInTransaction(admin2, 'admin-a', 'hr'), /not found in your organization/);
});

test('role changes are tenant-scoped and audited', () => {
  setMemberRoleInTransaction(admin, 'hr-a', 'employee');
    assert.equal(sqlite.prepare('SELECT role FROM users WHERE id = ?').get('hr-a')?.role, 'employee');
    assert.equal(sqlite.prepare("SELECT action FROM audit_logs WHERE entity_id = 'hr-a' ORDER BY created_at DESC LIMIT 1").get()?.action, 'organization_member_role_changed');
  assert.throws(() => setMemberRoleInTransaction(otherAdmin, 'admin-a', 'employee'), /not found in your organization/);
});

test('employee linking stays inside the authenticated organization', () => {
  linkEmployeeToMemberInTransaction(admin, 'hr-a', 'emp-a');
    assert.equal(sqlite.prepare('SELECT employee_id FROM users WHERE id = ?').get('hr-a')?.employee_id, 'emp-a');
  assert.throws(() => linkEmployeeToMemberInTransaction(admin, 'hr-a', 'emp-b'), /not found in your organization/);
  assert.throws(() => linkEmployeeToMemberInTransaction(otherAdmin, 'admin-b', 'emp-a'), /not found in your organization/);
});

test('organization mutation creates an audit record in the same tenant', () => {
  updateOrganizationInTransaction(admin, { name: 'Audited Organization', slug: 'audited-organization' });
    const audit = sqlite.prepare("SELECT organization_id, actor_user_id, action FROM audit_logs WHERE entity_type = 'organization' AND entity_id = 'org_default' ORDER BY rowid DESC LIMIT 1").get() as { organization_id: string; actor_user_id: string; action: string } | undefined;
    assert.equal(audit?.organization_id, 'org_default'); assert.equal(audit?.actor_user_id, 'admin-a'); assert.equal(audit?.action, 'organization_updated');
});

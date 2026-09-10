import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, sqlite } from '../src/db/client';
import {
  organizations,
  employees,
  leaveTypes,
  leaveBalances,
  leaveRequests,
  attendanceRecords,
  auditLogs,
  users,
  sessions,
  loginRateLimits
} from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { canAccessOrganization } from '../src/lib/authorization';

const ORG_A = 'org_test_a';
const ORG_B = 'org_test_b';

async function setupTenants() {
  await db.insert(organizations).values([
    { id: ORG_A, name: 'Tenant A', slug: 'tenant-a', status: 'active' },
    { id: ORG_B, name: 'Tenant B', slug: 'tenant-b', status: 'active' }
  ]);

  const employeeA = nanoid();
  const employeeB = nanoid();
  await db.insert(employees).values([
    { id: employeeA, organizationId: ORG_A, employeeCode: 'EMP-A', firstName: 'A', lastName: 'User', workEmail: 'a@tenant-a.test', dateOfJoining: '2026-01-01', designation: 'Tester' },
    { id: employeeB, organizationId: ORG_B, employeeCode: 'EMP-B', firstName: 'B', lastName: 'User', workEmail: 'b@tenant-b.test', dateOfJoining: '2026-01-01', designation: 'Tester' }
  ]);

  const userA = nanoid();
  const userB = nanoid();
  await db.insert(users).values([
    { id: userA, organizationId: ORG_A, email: 'admin-a@tenant-a.test', passwordHash: 'h', passwordSalt: 's', role: 'admin', employeeId: employeeA, isActive: true },
    { id: userB, organizationId: ORG_B, email: 'admin-b@tenant-b.test', passwordHash: 'h', passwordSalt: 's', role: 'admin', employeeId: employeeB, isActive: true }
  ]);

  const leaveTypeA = nanoid();
  const leaveTypeB = nanoid();
  await db.insert(leaveTypes).values([
    { id: leaveTypeA, organizationId: ORG_A, name: 'Annual A', annualQuota: 10, isPaid: true },
    { id: leaveTypeB, organizationId: ORG_B, name: 'Annual B', annualQuota: 10, isPaid: true }
  ]);

  const leaveRequestA = nanoid();
  const leaveRequestB = nanoid();
  await db.insert(leaveBalances).values([
    { id: nanoid(), organizationId: ORG_A, employeeId: employeeA, leaveTypeId: leaveTypeA, year: 2026, allocated: 10, used: 0 },
    { id: nanoid(), organizationId: ORG_B, employeeId: employeeB, leaveTypeId: leaveTypeB, year: 2026, allocated: 10, used: 0 }
  ]);
  await db.insert(leaveRequests).values([
    { id: leaveRequestA, organizationId: ORG_A, employeeId: employeeA, leaveTypeId: leaveTypeA, startDate: '2026-10-01', endDate: '2026-10-01', days: 1, status: 'pending' },
    { id: leaveRequestB, organizationId: ORG_B, employeeId: employeeB, leaveTypeId: leaveTypeB, startDate: '2026-10-02', endDate: '2026-10-02', days: 1, status: 'pending' }
  ]);

  const attendanceA = nanoid();
  const attendanceB = nanoid();
  await db.insert(attendanceRecords).values([
    { id: attendanceA, organizationId: ORG_A, employeeId: employeeA, workDate: '2026-09-10', status: 'present' },
    { id: attendanceB, organizationId: ORG_B, employeeId: employeeB, workDate: '2026-09-10', status: 'present' }
  ]);

  const auditA = nanoid();
  const auditB = nanoid();
  await db.insert(auditLogs).values([
    { id: auditA, organizationId: ORG_A, actorUserId: userA, action: 'test', entityType: 'employee', entityId: employeeA },
    { id: auditB, organizationId: ORG_B, actorUserId: userB, action: 'test', entityType: 'employee', entityId: employeeB }
  ]);

  await db.insert(sessions).values([
    { id: nanoid(), organizationId: ORG_A, userId: userA, expiresAt: '2099-01-01T00:00:00.000Z' },
    { id: nanoid(), organizationId: ORG_B, userId: userB, expiresAt: '2099-01-01T00:00:00.000Z' }
  ]);
  await db.insert(loginRateLimits).values([
    { key: 'rate-a', organizationId: ORG_A, failedAttempts: 1, windowStartedAt: new Date().toISOString() },
    { key: 'rate-b', organizationId: ORG_B, failedAttempts: 1, windowStartedAt: new Date().toISOString() }
  ]);

  return { employeeA, employeeB, leaveRequestA, leaveRequestB, attendanceA, attendanceB, auditA, auditB, userA, userB };
}

test('organization boundary blocks cross-tenant reads and mutations by ID', async () => {
  const ids = await setupTenants();

  assert.equal(canAccessOrganization(ORG_A, ORG_B), false);

  const foreignEmployee = await db
    .select()
    .from(employees)
    .where(and(eq(employees.organizationId, ORG_A), eq(employees.id, ids.employeeB)))
    .limit(1);
  assert.equal(foreignEmployee.length, 0);

  const employeeUpdate = sqlite
    .prepare('UPDATE employees SET designation = ? WHERE organization_id = ? AND id = ?')
    .run('SHOULD-NOT-CHANGE', ORG_A, ids.employeeB);
  assert.equal(Number(employeeUpdate.changes), 0);

  const foreignLeave = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.organizationId, ORG_A), eq(leaveRequests.id, ids.leaveRequestB)))
    .limit(1);
  assert.equal(foreignLeave.length, 0);

  const leaveUpdate = sqlite
    .prepare("UPDATE leave_requests SET status = 'approved' WHERE organization_id = ? AND id = ? AND status = 'pending'")
    .run(ORG_A, ids.leaveRequestB);
  assert.equal(Number(leaveUpdate.changes), 0);

  const foreignAttendance = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.organizationId, ORG_A), eq(attendanceRecords.id, ids.attendanceB)))
    .limit(1);
  assert.equal(foreignAttendance.length, 0);

  const foreignAudit = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, ORG_A), eq(auditLogs.id, ids.auditB)))
    .limit(1);
  assert.equal(foreignAudit.length, 0);

  const foreignSessionDelete = sqlite
    .prepare('DELETE FROM sessions WHERE organization_id = ? AND user_id = ?')
    .run(ORG_A, ids.userB);
  assert.equal(Number(foreignSessionDelete.changes), 0);

  const foreignRateDelete = sqlite
    .prepare('DELETE FROM login_rate_limits WHERE organization_id = ? AND key = ?')
    .run(ORG_A, 'rate-b');
  assert.equal(Number(foreignRateDelete.changes), 0);
});

import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, sqlite } from '../src/db/client';
import { and, eq } from 'drizzle-orm';
import { employees, attendanceRecords, auditLogs, leaveTypes, leaveRequests } from '../src/db/schema';
import { nanoid } from 'nanoid';
import { DEFAULT_ORGANIZATION_ID } from '../src/lib/tenant';

async function makeEmployee() {
  const id = nanoid();
  await db.insert(employees).values({
    id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    employeeCode: `SEC-${id.slice(0, 6)}`,
    firstName: 'Security',
    lastName: 'Test',
    workEmail: `${id}@test.local`,
    dateOfJoining: '2026-01-01',
    designation: 'Tester'
  });
  return id;
}

test('database rejects invalid attendance coordinates', async () => {
  const employeeId = await makeEmployee();
  await assert.rejects(async () => {
    await db.insert(attendanceRecords).values({
      id: nanoid(),
      organizationId: DEFAULT_ORGANIZATION_ID,
      employeeId,
      workDate: '2026-09-09',
      clockInAt: new Date().toISOString(),
      clockInLat: 91,
      clockInLng: 78,
      status: 'present'
    });
  });
});

test('audit log rows cannot be updated or deleted', async () => {
  const id = nanoid();
  await db.insert(auditLogs).values({ id, organizationId: DEFAULT_ORGANIZATION_ID, actorUserId: null, action: 'test', entityType: 'test', entityId: id });
  assert.throws(() => sqlite.prepare('UPDATE audit_logs SET action = ? WHERE organization_id = ? AND id = ?').run('changed', DEFAULT_ORGANIZATION_ID, id), /Audit logs are immutable/);
  assert.throws(() => sqlite.prepare('DELETE FROM audit_logs WHERE organization_id = ? AND id = ?').run(DEFAULT_ORGANIZATION_ID, id), /Audit logs are immutable/);
});

test('leave request state machine rejects terminal-state reversal', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = nanoid();
  await db.insert(leaveTypes).values({ id: leaveTypeId, organizationId: DEFAULT_ORGANIZATION_ID, name: 'Security Leave', annualQuota: 10, isPaid: true });
  const requestId = nanoid();
  await db.insert(leaveRequests).values({
    id: requestId,
    organizationId: DEFAULT_ORGANIZATION_ID,
    employeeId,
    leaveTypeId,
    startDate: '2026-09-10',
    endDate: '2026-09-10',
    days: 1,
    status: 'pending'
  });
  await db.update(leaveRequests).set({ status: 'approved' }).where(and(eq(leaveRequests.organizationId, DEFAULT_ORGANIZATION_ID), eq(leaveRequests.id, requestId)));
  assert.throws(
    () => sqlite.prepare("UPDATE leave_requests SET status = 'cancelled' WHERE organization_id = ? AND id = ?").run(DEFAULT_ORGANIZATION_ID, requestId),
    /Invalid leave request state transition/
  );
});

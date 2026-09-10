import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, sqlite } from '../src/db/client';
import { eq } from 'drizzle-orm';
import { employees, attendanceRecords, auditLogs, leaveTypes, leaveRequests } from '../src/db/schema';
import { nanoid } from 'nanoid';

async function makeEmployee() {
  const id = nanoid();
  await db.insert(employees).values({
    id,
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
      employeeId,
      workDate: '2026-09-09',
      clockInAt: new Date().toISOString(),
      clockInLat: 91,
      clockInLng: 78,
      status: 'present'
    });
  }, (error: unknown) => String(error) .includes('Invalid attendance coordinates') || String((error as { cause?: unknown })?.cause ?? '').includes('Invalid attendance coordinates'));
});

test('database rejects clock-out without clock-in on insert', async () => {
  const employeeId = await makeEmployee();
  await assert.rejects(async () => {
    await db.insert(attendanceRecords).values({
      id: nanoid(),
      employeeId,
      workDate: '2026-09-10',
      clockOutAt: new Date().toISOString(),
      status: 'present'
    });
  }, (error: unknown) => String(error).includes('Clock-out requires clock-in') || String((error as { cause?: unknown })?.cause ?? '').includes('Clock-out requires clock-in'));
});

test('audit log rows cannot be updated or deleted', async () => {
  const id = nanoid();
  await db.insert(auditLogs).values({ id, actorUserId: null, action: 'test', entityType: 'test', entityId: id });
  assert.throws(() => sqlite.prepare('UPDATE audit_logs SET action = ? WHERE id = ?').run('changed', id), /Audit logs are immutable/);
  assert.throws(() => sqlite.prepare('DELETE FROM audit_logs WHERE id = ?').run(id), /Audit logs are immutable/);
});

test('leave request state machine rejects terminal-state reversal', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = nanoid();
  await db.insert(leaveTypes).values({ id: leaveTypeId, name: 'Security Leave', annualQuota: 10, isPaid: true });
  const requestId = nanoid();
  await db.insert(leaveRequests).values({
    id: requestId,
    employeeId,
    leaveTypeId,
    startDate: '2026-09-10',
    endDate: '2026-09-10',
    days: 1,
    status: 'pending'
  });
  await db.update(leaveRequests).set({ status: 'approved' }).where(eq(leaveRequests.id, requestId));
  assert.throws(
    () => sqlite.prepare("UPDATE leave_requests SET status = 'cancelled' WHERE id = ?").run(requestId),
    /Invalid leave request state transition/
  );
});

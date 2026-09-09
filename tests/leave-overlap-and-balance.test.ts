import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/client';
import { employees, leaveTypes, leaveBalances, leaveRequests } from '../src/db/schema';
import { hasOverlappingLeave, getRemainingBalance } from '../src/lib/leave-rules';
import { nanoid } from 'nanoid';

async function makeEmployee() {
  const id = nanoid();
  await db.insert(employees).values({
    id,
    employeeCode: `TEST-${id.slice(0, 6)}`,
    firstName: 'Test',
    lastName: 'Employee',
    workEmail: `${id}@test.local`,
    dateOfJoining: '2026-01-01',
    designation: 'Tester'
  });
  return id;
}

async function makeLeaveType(annualQuota: number) {
  const id = nanoid();
  await db.insert(leaveTypes).values({ id, name: `Test Leave ${id.slice(0, 4)}`, annualQuota, isPaid: true });
  return id;
}

test('no overlap when employee has no existing leave', async () => {
  const employeeId = await makeEmployee();
  const overlaps = await hasOverlappingLeave(employeeId, '2026-09-10', '2026-09-12');
  assert.equal(overlaps, false);
});

test('detects an overlapping pending request', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = await makeLeaveType(18);

  await db.insert(leaveRequests).values({
    id: nanoid(),
    employeeId,
    leaveTypeId,
    startDate: '2026-09-10',
    endDate: '2026-09-15',
    days: 6,
    status: 'pending'
  });

  const overlaps = await hasOverlappingLeave(employeeId, '2026-09-12', '2026-09-18');
  assert.equal(overlaps, true);
});

test('does not flag a non-overlapping request as overlapping', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = await makeLeaveType(18);

  await db.insert(leaveRequests).values({
    id: nanoid(),
    employeeId,
    leaveTypeId,
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    status: 'approved',
    days: 5
  });

  const overlaps = await hasOverlappingLeave(employeeId, '2026-09-10', '2026-09-12');
  assert.equal(overlaps, false);
});

test('ignores cancelled/rejected requests when checking overlap', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = await makeLeaveType(18);

  await db.insert(leaveRequests).values({
    id: nanoid(),
    employeeId,
    leaveTypeId,
    startDate: '2026-09-10',
    endDate: '2026-09-15',
    days: 6,
    status: 'rejected'
  });

  const overlaps = await hasOverlappingLeave(employeeId, '2026-09-10', '2026-09-15');
  assert.equal(overlaps, false);
});

test('remaining balance reflects allocated minus used', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = await makeLeaveType(18);
  const year = 2026;

  await db.insert(leaveBalances).values({ id: nanoid(), employeeId, leaveTypeId, year, allocated: 18, used: 5 });

  const balance = await getRemainingBalance(employeeId, leaveTypeId, year);
  assert.ok(balance);
  assert.equal(balance!.remaining, 13);
});

test('returns null when no balance record exists for that year', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = await makeLeaveType(18);

  const balance = await getRemainingBalance(employeeId, leaveTypeId, 2099);
  assert.equal(balance, null);
});

import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db/client';
import { employees, attendanceRecords } from '../src/db/schema';
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

test('a single attendance record can be created for a given day', async () => {
  const employeeId = await makeEmployee();
  await db.insert(attendanceRecords).values({
    id: nanoid(),
    employeeId,
    workDate: '2026-09-09',
    clockInAt: new Date().toISOString(),
    status: 'present'
  });

  const rows = await db.select().from(attendanceRecords);
  assert.equal(rows.filter((r) => r.employeeId === employeeId).length, 1);
});

test('the database rejects a second attendance record for the same employee and day', async () => {
  const employeeId = await makeEmployee();
  await db.insert(attendanceRecords).values({
    id: nanoid(),
    employeeId,
    workDate: '2026-09-09',
    clockInAt: new Date().toISOString(),
    status: 'present'
  });

  await assert.rejects(async () => {
    await db.insert(attendanceRecords).values({
      id: nanoid(),
      employeeId,
      workDate: '2026-09-09',
      clockInAt: new Date().toISOString(),
      status: 'present'
    });
  });
});

test('the same employee can have separate records on different days', async () => {
  const employeeId = await makeEmployee();
  await db.insert(attendanceRecords).values({
    id: nanoid(),
    employeeId,
    workDate: '2026-09-09',
    clockInAt: new Date().toISOString(),
    status: 'present'
  });
  await db.insert(attendanceRecords).values({
    id: nanoid(),
    employeeId,
    workDate: '2026-09-10',
    clockInAt: new Date().toISOString(),
    status: 'present'
  });

  const rows = await db.select().from(attendanceRecords);
  assert.equal(rows.filter((r) => r.employeeId === employeeId).length, 2);
});

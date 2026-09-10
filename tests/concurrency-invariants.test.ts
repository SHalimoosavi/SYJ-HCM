import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlite, db } from '../src/db/client';
import { employees, leaveTypes, leaveBalances } from '../src/db/schema';
import { nanoid } from 'nanoid';
import { DEFAULT_ORGANIZATION_ID } from '../src/lib/tenant';

async function makeEmployee() {
  const id = nanoid();
  await db.insert(employees).values({
    id,
    organizationId: DEFAULT_ORGANIZATION_ID,
    employeeCode: `CON-${id.slice(0, 6)}`,
    firstName: 'Concurrency',
    lastName: 'Test',
    workEmail: `${id}@test.local`,
    dateOfJoining: '2026-01-01',
    designation: 'Tester'
  });
  return id;
}

test('conditional leave balance update permits only one approval when one day remains', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = nanoid();
  await db.insert(leaveTypes).values({ id: leaveTypeId, organizationId: DEFAULT_ORGANIZATION_ID, name: 'Race Leave', annualQuota: 1, isPaid: true });
  const balanceId = nanoid();
  await db.insert(leaveBalances).values({ id: balanceId, organizationId: DEFAULT_ORGANIZATION_ID, employeeId, leaveTypeId, year: 2026, allocated: 1, used: 0 });

  const statement = sqlite.prepare(`
    UPDATE leave_balances
    SET used = used + 1, updated_at = ?
    WHERE organization_id = ? AND id = ? AND allocated - used >= 1
  `);

  const first = statement.run(new Date().toISOString(), DEFAULT_ORGANIZATION_ID, balanceId);
  const second = statement.run(new Date().toISOString(), DEFAULT_ORGANIZATION_ID, balanceId);
  assert.equal(Number(first.changes), 1);
  assert.equal(Number(second.changes), 0);

  const row = sqlite.prepare('SELECT allocated, used FROM leave_balances WHERE organization_id = ? AND id = ?').get(DEFAULT_ORGANIZATION_ID, balanceId) as { allocated: number; used: number };
  assert.equal(row.used, 1);
  assert.ok(row.used <= row.allocated);
});

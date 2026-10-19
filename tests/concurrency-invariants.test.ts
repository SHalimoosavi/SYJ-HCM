import '../tests/helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, setTenantContext } from '../src/db/client';
import { employees, leaveTypes, leaveBalances } from '../src/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { DEFAULT_ORGANIZATION_ID } from '../src/lib/tenant';

async function makeEmployee() {
  const id = nanoid();
  await db.transaction(async (tx) => {
    await setTenantContext(tx, DEFAULT_ORGANIZATION_ID);
    await tx.insert(employees).values({
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      employeeCode: `CON-${id.slice(0, 6)}`,
      firstName: 'Concurrency',
      lastName: 'Test',
      workEmail: `${id}@test.local`,
      dateOfJoining: '2026-01-01',
      designation: 'Tester',
    });
  });
  return id;
}

test('conditional leave balance update permits only one approval when one day remains', async () => {
  const employeeId = await makeEmployee();
  const leaveTypeId = nanoid();
  const balanceId = nanoid();

  await db.transaction(async (tx) => {
    await setTenantContext(tx, DEFAULT_ORGANIZATION_ID);
    await tx.insert(leaveTypes).values({ id: leaveTypeId, organizationId: DEFAULT_ORGANIZATION_ID, name: 'Race Leave', annualQuota: 1, isPaid: true });
    await tx.insert(leaveBalances).values({ id: balanceId, organizationId: DEFAULT_ORGANIZATION_ID, employeeId, leaveTypeId, year: 2026, allocated: 1, used: 0 });
  });

  const approve = async () => db.transaction(async (tx) => {
    await setTenantContext(tx, DEFAULT_ORGANIZATION_ID);
    const updated = await tx.update(leaveBalances)
      .set({ used: sql`${leaveBalances.used} + 1`, updatedAt: new Date().toISOString() })
      .where(and(eq(leaveBalances.organizationId, DEFAULT_ORGANIZATION_ID), eq(leaveBalances.id, balanceId), sql`${leaveBalances.allocated} - ${leaveBalances.used} >= 1`))
      .returning({ id: leaveBalances.id });
    return updated.length;
  });

  const [first, second] = await Promise.all([approve(), approve()]);
  assert.deepEqual([first, second].sort(), [0, 1]);

  const row = await db.transaction(async (tx) => {
    await setTenantContext(tx, DEFAULT_ORGANIZATION_ID);
    const rows = await tx.select({ allocated: leaveBalances.allocated, used: leaveBalances.used }).from(leaveBalances).where(and(eq(leaveBalances.organizationId, DEFAULT_ORGANIZATION_ID), eq(leaveBalances.id, balanceId))).limit(1);
    return rows[0];
  });
  assert.equal(row?.used, 1);
  assert.ok((row?.used ?? 0) <= (row?.allocated ?? 0));
});

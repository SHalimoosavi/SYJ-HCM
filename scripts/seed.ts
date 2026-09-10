/**
 * Development-only seed data.
 * Refuses to run unless ALLOW_DEV_SEED=true is set in the environment.
 * This is intentionally NOT run automatically on migrate/build/start.
 */
import { db } from '../src/db/client';
import { organizations, departments, employees, users, leaveTypes, leaveBalances } from '../src/db/schema';
import { hashPassword } from '../src/lib/password';
import { nanoid } from 'nanoid';
import { DEFAULT_ORGANIZATION_ID } from '../src/lib/tenant';

async function main() {
  if (process.env.ALLOW_DEV_SEED !== 'true') {
    console.error('Refusing to seed: set ALLOW_DEV_SEED=true to run this in a dev environment.');
    process.exit(1);
  }

  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) {
    console.log('Seed skipped: users table is not empty.');
    return;
  }

  await db.insert(organizations).values({ id: DEFAULT_ORGANIZATION_ID, name: 'Default Organization', slug: 'default', status: 'active' });

  const engDeptId = nanoid();
  const hrDeptId = nanoid();
  await db.insert(departments).values([
    { id: engDeptId, organizationId: DEFAULT_ORGANIZATION_ID, name: 'Engineering' },
    { id: hrDeptId, organizationId: DEFAULT_ORGANIZATION_ID, name: 'Human Resources' }
  ]);

  const adminEmployeeId = nanoid();
  await db.insert(employees).values({
    id: adminEmployeeId,
    organizationId: DEFAULT_ORGANIZATION_ID,
    employeeCode: 'EMP-0001',
    firstName: 'Ali',
    lastName: 'Admin',
    workEmail: 'admin@syj-hcm.local',
    dateOfJoining: new Date().toISOString().slice(0, 10),
    departmentId: hrDeptId,
    designation: 'HR Administrator',
    employmentStatus: 'active',
    employmentType: 'full_time'
  });

  const { hash, salt } = hashPassword('ChangeMe123!');
  await db.insert(users).values({
    id: nanoid(),
    organizationId: DEFAULT_ORGANIZATION_ID,
    email: 'admin@syj-hcm.local',
    passwordHash: hash,
    passwordSalt: salt,
    role: 'admin',
    employeeId: adminEmployeeId,
    isActive: true
  });

  const employeeEmployeeId = nanoid();
  await db.insert(employees).values({
    id: employeeEmployeeId,
    organizationId: DEFAULT_ORGANIZATION_ID,
    employeeCode: 'EMP-0002',
    firstName: 'Sana',
    lastName: 'Sample',
    workEmail: 'sana@syj-hcm.local',
    dateOfJoining: new Date().toISOString().slice(0, 10),
    departmentId: engDeptId,
    designation: 'Software Engineer',
    employmentStatus: 'active',
    employmentType: 'full_time'
  });

  const { hash: h2, salt: s2 } = hashPassword('ChangeMe123!');
  await db.insert(users).values({
    id: nanoid(),
    organizationId: DEFAULT_ORGANIZATION_ID,
    email: 'sana@syj-hcm.local',
    passwordHash: h2,
    passwordSalt: s2,
    role: 'employee',
    employeeId: employeeEmployeeId,
    isActive: true
  });

  const annualId = nanoid();
  const sickId = nanoid();
  await db.insert(leaveTypes).values([
    { id: annualId, organizationId: DEFAULT_ORGANIZATION_ID, name: 'Annual Leave', annualQuota: 18, isPaid: true },
    { id: sickId, organizationId: DEFAULT_ORGANIZATION_ID, name: 'Sick Leave', annualQuota: 10, isPaid: true }
  ]);

  const year = new Date().getFullYear();
  await db.insert(leaveBalances).values([
    { id: nanoid(), organizationId: DEFAULT_ORGANIZATION_ID, employeeId: adminEmployeeId, leaveTypeId: annualId, year, allocated: 18, used: 0 },
    { id: nanoid(), organizationId: DEFAULT_ORGANIZATION_ID, employeeId: adminEmployeeId, leaveTypeId: sickId, year, allocated: 10, used: 0 },
    { id: nanoid(), organizationId: DEFAULT_ORGANIZATION_ID, employeeId: employeeEmployeeId, leaveTypeId: annualId, year, allocated: 18, used: 0 },
    { id: nanoid(), organizationId: DEFAULT_ORGANIZATION_ID, employeeId: employeeEmployeeId, leaveTypeId: sickId, year, allocated: 10, used: 0 }
  ]);

  console.log('Seed complete.');
  console.log('  admin@syj-hcm.local / ChangeMe123!  (role: admin)');
  console.log('  sana@syj-hcm.local  / ChangeMe123!  (role: employee)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

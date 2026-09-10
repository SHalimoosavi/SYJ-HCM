'use server';

import { db, sqlite, withSqliteTransactionSync } from '@/db/client';
import { employees, departments, leaveTypes, leaveBalances } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRoleForAction } from '@/lib/auth';
import { recordAuditSync } from '@/lib/audit';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export type EmployeeFormState = { error: string | null };

function requiredString(formData: FormData, key: string): string {
  const value = String(formData.get(key) || '').trim();
  return value;
}

async function assertUniqueCodeAndEmail(code: string, email: string, excludeId?: string) {
  const byCode = await db.select().from(employees).where(eq(employees.employeeCode, code));
  if (byCode.some((e) => e.id !== excludeId)) {
    throw new Error(`Employee code "${code}" is already in use.`);
  }
  const byEmail = await db.select().from(employees).where(eq(employees.workEmail, email));
  if (byEmail.some((e) => e.id !== excludeId)) {
    throw new Error(`Work email "${email}" is already in use.`);
  }
}

export async function createEmployeeAction(
  _prevState: EmployeeFormState,
  formData: FormData
): Promise<EmployeeFormState> {
  const actor = await requireRoleForAction('admin', 'hr');

  const employeeCode = requiredString(formData, 'employeeCode');
  const firstName = requiredString(formData, 'firstName');
  const lastName = requiredString(formData, 'lastName');
  const workEmail = requiredString(formData, 'workEmail').toLowerCase();
  const dateOfJoining = requiredString(formData, 'dateOfJoining');
  const designation = requiredString(formData, 'designation');
  const departmentId = requiredString(formData, 'departmentId') || null;
  const employmentType = requiredString(formData, 'employmentType') || 'full_time';
  const location = requiredString(formData, 'location') || null;
  const phone = requiredString(formData, 'phone') || null;

  if (!employeeCode || !firstName || !lastName || !workEmail || !dateOfJoining || !designation) {
    return { error: 'Please fill in all required fields.' };
  }
  if (!/^\S+@\S+\.\S+$/.test(workEmail)) {
    return { error: 'Please enter a valid work email address.' };
  }
  if (Number.isNaN(new Date(dateOfJoining).getTime())) {
    return { error: 'Please enter a valid date of joining.' };
  }

  try {
    await assertUniqueCodeAndEmail(employeeCode, workEmail);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const id = nanoid();
  const types = await db.select().from(leaveTypes);
  const year = new Date().getFullYear();

  try {
    withSqliteTransactionSync(() => {
      sqlite
        .prepare(`
          INSERT INTO employees
            (id, employee_code, first_name, last_name, work_email, date_of_joining, designation, department_id, employment_type, location, phone, employment_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `)
        .run(id, employeeCode, firstName, lastName, workEmail, dateOfJoining, designation, departmentId, employmentType, location, phone);

      const balanceStatement = sqlite.prepare(`
        INSERT INTO leave_balances (id, employee_id, leave_type_id, year, allocated, used)
        VALUES (?, ?, ?, ?, ?, 0)
      `);
      for (const type of types) {
        balanceStatement.run(nanoid(), id, type.id, year, type.annualQuota);
      }

      recordAuditSync({ actorUserId: actor.id, action: 'employee_created', entityType: 'employee', entityId: id });
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unable to create employee.' };
  }

  revalidatePath('/employees');
  redirect(`/employees/${id}`);
}

export async function updateEmployeeAction(
  employeeId: string,
  _prevState: EmployeeFormState,
  formData: FormData
): Promise<EmployeeFormState> {
  const actor = await requireRoleForAction('admin', 'hr');

  const existing = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  const existingEmployee = existing[0];
  if (!existingEmployee) {
    return { error: 'Employee not found.' };
  }

  const firstName = requiredString(formData, 'firstName');
  const lastName = requiredString(formData, 'lastName');
  const workEmail = requiredString(formData, 'workEmail').toLowerCase();
  const designation = requiredString(formData, 'designation');
  const departmentId = requiredString(formData, 'departmentId') || null;
  const employmentType = requiredString(formData, 'employmentType') || 'full_time';
  const location = requiredString(formData, 'location') || null;
  const phone = requiredString(formData, 'phone') || null;
  const address = requiredString(formData, 'address') || null;
  const emergencyContactName = requiredString(formData, 'emergencyContactName') || null;
  const emergencyContactPhone = requiredString(formData, 'emergencyContactPhone') || null;

  if (!firstName || !lastName || !workEmail || !designation) {
    return { error: 'Please fill in all required fields.' };
  }
  if (!/^\S+@\S+\.\S+$/.test(workEmail)) {
    return { error: 'Please enter a valid work email address.' };
  }

  try {
    await assertUniqueCodeAndEmail(existingEmployee.employeeCode, workEmail, employeeId);
  } catch (err) {
    return { error: (err as Error).message };
  }

  try {
    withSqliteTransactionSync(() => {
      sqlite
        .prepare(`
          UPDATE employees
          SET first_name = ?, last_name = ?, work_email = ?, designation = ?, department_id = ?,
              employment_type = ?, location = ?, phone = ?, address = ?, emergency_contact_name = ?,
              emergency_contact_phone = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(firstName, lastName, workEmail, designation, departmentId, employmentType, location, phone, address, emergencyContactName, emergencyContactPhone, new Date().toISOString(), employeeId);
      recordAuditSync({ actorUserId: actor.id, action: 'employee_updated', entityType: 'employee', entityId: employeeId });
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unable to update employee.' };
  }

  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/employees');
  return { error: null };
}

export async function setEmployeeStatusAction(employeeId: string, status: 'active' | 'inactive'): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');

  withSqliteTransactionSync(() => {
    sqlite
      .prepare('UPDATE employees SET employment_status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), employeeId);
    recordAuditSync({
      actorUserId: actor.id,
      action: status === 'active' ? 'employee_activated' : 'employee_deactivated',
      entityType: 'employee',
      entityId: employeeId
    });
  });

  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/employees');
}

export async function listDepartments() {
  return db.select().from(departments);
}

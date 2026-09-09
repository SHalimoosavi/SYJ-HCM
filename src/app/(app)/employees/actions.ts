'use server';

import { db } from '@/db/client';
import { employees, departments, leaveTypes, leaveBalances } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRoleForAction } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
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
  await db.insert(employees).values({
    id,
    employeeCode,
    firstName,
    lastName,
    workEmail,
    dateOfJoining,
    designation,
    departmentId,
    employmentType: employmentType as 'full_time' | 'part_time' | 'contract' | 'intern',
    location,
    phone,
    employmentStatus: 'active'
  });

  // Seed leave balances for the current year from existing leave types,
  // so new hires immediately have a usable leave balance.
  const types = await db.select().from(leaveTypes);
  const year = new Date().getFullYear();
  if (types.length > 0) {
    await db
      .insert(leaveBalances)
      .values(types.map((t) => ({ id: nanoid(), employeeId: id, leaveTypeId: t.id, year, allocated: t.annualQuota, used: 0 })));
  }

  await recordAudit({ actorUserId: actor.id, action: 'employee_created', entityType: 'employee', entityId: id });

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

  await db
    .update(employees)
    .set({
      firstName,
      lastName,
      workEmail,
      designation,
      departmentId,
      employmentType: employmentType as 'full_time' | 'part_time' | 'contract' | 'intern',
      location,
      phone,
      address,
      emergencyContactName,
      emergencyContactPhone,
      updatedAt: new Date().toISOString()
    })
    .where(eq(employees.id, employeeId));

  await recordAudit({ actorUserId: actor.id, action: 'employee_updated', entityType: 'employee', entityId: employeeId });

  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/employees');
  return { error: null };
}

export async function setEmployeeStatusAction(employeeId: string, status: 'active' | 'inactive'): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');

  await db
    .update(employees)
    .set({ employmentStatus: status, updatedAt: new Date().toISOString() })
    .where(eq(employees.id, employeeId));

  await recordAudit({
    actorUserId: actor.id,
    action: status === 'active' ? 'employee_activated' : 'employee_deactivated',
    entityType: 'employee',
    entityId: employeeId
  });

  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/employees');
}

export async function listDepartments() {
  return db.select().from(departments);
}

'use server';

import { db, setTenantContext } from '@/db/client';
import { employees, departments, leaveTypes, leaveBalances } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireRoleForAction } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export type EmployeeFormState = { error: string | null };

function requiredString(formData: FormData, key: string): string {
  return String(formData.get(key) || '').trim();
}

async function assertDepartmentInOrganization(organizationId: string, departmentId: string | null): Promise<void> {
  if (!departmentId) return;
  const rows = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.organizationId, organizationId)))
    .limit(1);
  if (!rows[0]) throw new Error('Selected department is not part of your organization.');
}

async function assertUniqueCodeAndEmail(organizationId: string, code: string, email: string, excludeId?: string): Promise<void> {
  const byCode = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organizationId, organizationId), eq(employees.employeeCode, code)));
  if (byCode.some((e) => e.id !== excludeId)) {
    throw new Error(`Employee code "${code}" is already in use.`);
  }

  const byEmail = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organizationId, organizationId), eq(employees.workEmail, email)));
  if (byEmail.some((e) => e.id !== excludeId)) {
    throw new Error(`Work email "${email}" is already in use.`);
  }
}

export async function createEmployeeAction(
  _prevState: EmployeeFormState,
  formData: FormData,
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
    await assertDepartmentInOrganization(actor.organizationId, departmentId);
    await assertUniqueCodeAndEmail(actor.organizationId, employeeCode, workEmail);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid employee data.' };
  }

  const id = nanoid();
  const types = await db.select().from(leaveTypes).where(eq(leaveTypes.organizationId, actor.organizationId));
  const year = new Date().getFullYear();

  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);

      await tx.insert(employees).values({
        id,
        organizationId: actor.organizationId,
        employeeCode,
        firstName,
        lastName,
        workEmail,
        dateOfJoining,
        designation,
        departmentId,
        employmentType,
        location,
        phone,
        employmentStatus: 'active',
      });

      for (const type of types) {
        await tx.insert(leaveBalances).values({
          id: nanoid(),
          organizationId: actor.organizationId,
          employeeId: id,
          leaveTypeId: type.id,
          year,
          allocated: type.annualQuota,
          used: 0,
        });
      }

      await tx.insert((await import('@/db/schema')).auditLogs).values({
        id: nanoid(),
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: 'employee_created',
        entityType: 'employee',
        entityId: id,
      });
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
  formData: FormData,
): Promise<EmployeeFormState> {
  const actor = await requireRoleForAction('admin', 'hr');

  const existing = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, actor.organizationId)))
    .limit(1);
  const existingEmployee = existing[0];
  if (!existingEmployee) return { error: 'Employee not found.' };

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
    await assertDepartmentInOrganization(actor.organizationId, departmentId);
    await assertUniqueCodeAndEmail(actor.organizationId, existingEmployee.employeeCode, workEmail, employeeId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid employee data.' };
  }

  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, actor.organizationId);
      await tx
        .update(employees)
        .set({
          firstName,
          lastName,
          workEmail,
          designation,
          departmentId,
          employmentType,
          location,
          phone,
          address,
          emergencyContactName,
          emergencyContactPhone,
          updatedAt: new Date(),
        })
        .where(and(eq(employees.organizationId, actor.organizationId), eq(employees.id, employeeId)));

      await recordAudit({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: 'employee_updated',
        entityType: 'employee',
        entityId: employeeId,
      });
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

  await db.transaction(async (tx) => {
    await setTenantContext(tx, actor.organizationId);
    const result = await tx
      .update(employees)
      .set({ employmentStatus: status, updatedAt: new Date() })
      .where(and(eq(employees.organizationId, actor.organizationId), eq(employees.id, employeeId)))
      .returning({ id: employees.id });
    if (result.length !== 1) throw new Error('Employee not found.');

    await recordAudit({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      action: status === 'active' ? 'employee_activated' : 'employee_deactivated',
      entityType: 'employee',
      entityId: employeeId,
    });
  });

  revalidatePath(`/employees/${employeeId}`);
  revalidatePath('/employees');
}

export async function listDepartments() {
  const actor = await requireRoleForAction('admin', 'hr');
  return db.select().from(departments).where(eq(departments.organizationId, actor.organizationId));
}

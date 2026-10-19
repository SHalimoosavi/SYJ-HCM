'use server';

import { db, setTenantContext } from '@/db/client';
import { attendanceRecords, auditLogs } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireUserForAction } from '@/lib/auth';
import { parseCoordinates } from '@/lib/geolocation';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export type AttendanceActionState = { error: string | null };

export async function clockInAction(_prevState: AttendanceActionState, formData: FormData): Promise<AttendanceActionState> {
  const user = await requireUserForAction();
  if (!user.employeeId) {
    return { error: 'Your account is not linked to an employee record. Contact HR.' };
  }

  let coordinates;
  try {
    coordinates = parseCoordinates(formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid location data.' };
  }

  const workDate = todayStr();
  const now = new Date().toISOString();

  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, user.organizationId);

      const existing = await tx
        .select()
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.organizationId, user.organizationId),
          eq(attendanceRecords.employeeId, user.employeeId),
          eq(attendanceRecords.workDate, workDate),
        ))
        .limit(1);

      const current = existing[0];
      if (current?.clockInAt) throw new Error('You have already clocked in today.');

      if (current) {
        const updated = await tx
          .update(attendanceRecords)
          .set({
            clockInAt: now,
            clockInLat: coordinates?.latitude ?? null,
            clockInLng: coordinates?.longitude ?? null,
            status: 'present',
            updatedAt: now,
          })
          .where(and(
            eq(attendanceRecords.organizationId, user.organizationId),
            eq(attendanceRecords.id, current.id),
          ))
          .returning({ id: attendanceRecords.id });

        if (updated.length !== 1) throw new Error('You have already clocked in today.');
        await tx.insert(auditLogs).values({
          id: nanoid(),
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: 'clock_in',
          entityType: 'attendance_record',
          entityId: current.id,
        });
      } else {
        const id = nanoid();
        try {
          await tx.insert(attendanceRecords).values({
            id,
            organizationId: user.organizationId,
            employeeId: user.employeeId,
            workDate,
            clockInAt: now,
            clockInLat: coordinates?.latitude ?? null,
            clockInLng: coordinates?.longitude ?? null,
            status: 'present',
          });
        } catch (error) {
          if (error instanceof Error && /unique|constraint/i.test(error.message)) {
            throw new Error('You have already clocked in today.');
          }
          throw error;
        }
        await tx.insert(auditLogs).values({
          id: nanoid(),
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: 'clock_in',
          entityType: 'attendance_record',
          entityId: id,
        });
      }
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to clock in.' };
  }

  revalidatePath('/attendance');
  revalidatePath('/dashboard');
  return { error: null };
}

export async function clockOutAction(_prevState: AttendanceActionState, formData: FormData): Promise<AttendanceActionState> {
  const user = await requireUserForAction();
  if (!user.employeeId) {
    return { error: 'Your account is not linked to an employee record. Contact HR.' };
  }

  let coordinates;
  try {
    coordinates = parseCoordinates(formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid location data.' };
  }

  const workDate = todayStr();
  const now = new Date().toISOString();

  try {
    await db.transaction(async (tx) => {
      await setTenantContext(tx, user.organizationId);

      const existing = await tx
        .select()
        .from(attendanceRecords)
        .where(and(
          eq(attendanceRecords.organizationId, user.organizationId),
          eq(attendanceRecords.employeeId, user.employeeId),
          eq(attendanceRecords.workDate, workDate),
        ))
        .limit(1);

      const record = existing[0];
      if (!record || !record.clockInAt) throw new Error('You need to clock in before you can clock out.');
      if (record.clockOutAt) throw new Error('You have already clocked out today.');

      const updated = await tx
        .update(attendanceRecords)
        .set({
          clockOutAt: now,
          clockOutLat: coordinates?.latitude ?? null,
          clockOutLng: coordinates?.longitude ?? null,
          updatedAt: now,
        })
        .where(and(
          eq(attendanceRecords.organizationId, user.organizationId),
          eq(attendanceRecords.id, record.id),
        ))
        .returning({ id: attendanceRecords.id });

      if (updated.length !== 1) throw new Error('You have already clocked out today.');

      await tx.insert(auditLogs).values({
        id: nanoid(),
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'clock_out',
        entityType: 'attendance_record',
        entityId: record.id,
      });
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to clock out.' };
  }

  revalidatePath('/attendance');
  revalidatePath('/dashboard');
  return { error: null };
}

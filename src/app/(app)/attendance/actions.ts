'use server';

import { db, sqlite, withSqliteTransactionSync } from '@/db/client';
import { attendanceRecords } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireUserForAction } from '@/lib/auth';
import { recordAuditSync } from '@/lib/audit';
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
  const existing = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.organizationId, user.organizationId), eq(attendanceRecords.employeeId, user.employeeId), eq(attendanceRecords.workDate, workDate)))
    .limit(1);

  const current = existing[0];
  if (current?.clockInAt) {
    return { error: 'You have already clocked in today.' };
  }

  try {
    withSqliteTransactionSync(() => {
      if (current) {
        const updated = sqlite
          .prepare(`
            UPDATE attendance_records
            SET clock_in_at = ?, clock_in_lat = ?, clock_in_lng = ?, status = 'present', updated_at = ?
            WHERE organization_id = ? AND id = ? AND clock_in_at IS NULL
          `)
          .run(now, coordinates?.latitude ?? null, coordinates?.longitude ?? null, now, user.organizationId, current.id);
        if (Number(updated.changes) !== 1) throw new Error('You have already clocked in today.');
        recordAuditSync({ organizationId: user.organizationId, actorUserId: user.id, action: 'clock_in', entityType: 'attendance_record', entityId: current.id });
      } else {
        const id = nanoid();
        try {
          sqlite
            .prepare(`
              INSERT INTO attendance_records
                (id, organization_id, employee_id, work_date, clock_in_at, clock_in_lat, clock_in_lng, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'present')
            `)
            .run(id, user.organizationId, user.employeeId, workDate, now, coordinates?.latitude ?? null, coordinates?.longitude ?? null);
        } catch (error) {
          if (error instanceof Error && /unique|constraint/i.test(error.message)) {
            throw new Error('You have already clocked in today.');
          }
          throw error;
        }
        recordAuditSync({ organizationId: user.organizationId, actorUserId: user.id, action: 'clock_in', entityType: 'attendance_record', entityId: id });
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
  const existing = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.organizationId, user.organizationId), eq(attendanceRecords.employeeId, user.employeeId), eq(attendanceRecords.workDate, workDate)))
    .limit(1);

  const record = existing[0];
  if (!record || !record.clockInAt) {
    return { error: 'You need to clock in before you can clock out.' };
  }
  if (record.clockOutAt) {
    return { error: 'You have already clocked out today.' };
  }

  const now = new Date().toISOString();
  try {
    withSqliteTransactionSync(() => {
      const updated = sqlite
        .prepare(`
          UPDATE attendance_records
          SET clock_out_at = ?, clock_out_lat = ?, clock_out_lng = ?, updated_at = ?
          WHERE organization_id = ? AND id = ? AND clock_out_at IS NULL
        `)
        .run(now, coordinates?.latitude ?? null, coordinates?.longitude ?? null, now, user.organizationId, record.id);
      if (Number(updated.changes) !== 1) throw new Error('You have already clocked out today.');
      recordAuditSync({ organizationId: user.organizationId, actorUserId: user.id, action: 'clock_out', entityType: 'attendance_record', entityId: record.id });
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to clock out.' };
  }

  revalidatePath('/attendance');
  revalidatePath('/dashboard');
  return { error: null };
}

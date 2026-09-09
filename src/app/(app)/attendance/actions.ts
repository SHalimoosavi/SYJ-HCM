'use server';

import { db } from '@/db/client';
import { attendanceRecords } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireUserForAction } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
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

  const workDate = todayStr();
  const existing = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, user.employeeId), eq(attendanceRecords.workDate, workDate)))
    .limit(1);

  if (existing[0]?.clockInAt) {
    return { error: 'You have already clocked in today.' };
  }

  const latRaw = formData.get('lat');
  const lngRaw = formData.get('lng');
  const lat = latRaw ? Number(latRaw) : null;
  const lng = lngRaw ? Number(lngRaw) : null;

  // Server-side timestamp is authoritative - the client cannot spoof this.
  const now = new Date().toISOString();

  if (existing[0]) {
    const record = existing[0];
    await db
      .update(attendanceRecords)
      .set({ clockInAt: now, clockInLat: lat, clockInLng: lng, status: 'present', updatedAt: now })
      .where(eq(attendanceRecords.id, record.id));
    await recordAudit({ actorUserId: user.id, action: 'clock_in', entityType: 'attendance_record', entityId: record.id });
  } else {
    const id = nanoid();
    await db.insert(attendanceRecords).values({
      id,
      employeeId: user.employeeId,
      workDate,
      clockInAt: now,
      clockInLat: lat,
      clockInLng: lng,
      status: 'present'
    });
    await recordAudit({ actorUserId: user.id, action: 'clock_in', entityType: 'attendance_record', entityId: id });
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

  const workDate = todayStr();
  const existing = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.employeeId, user.employeeId), eq(attendanceRecords.workDate, workDate)))
    .limit(1);

  const record = existing[0];
  if (!record || !record.clockInAt) {
    return { error: 'You need to clock in before you can clock out.' };
  }
  if (record.clockOutAt) {
    return { error: 'You have already clocked out today.' };
  }

  const latRaw = formData.get('lat');
  const lngRaw = formData.get('lng');
  const lat = latRaw ? Number(latRaw) : null;
  const lng = lngRaw ? Number(lngRaw) : null;
  const now = new Date().toISOString();

  await db
    .update(attendanceRecords)
    .set({ clockOutAt: now, clockOutLat: lat, clockOutLng: lng, updatedAt: now })
    .where(eq(attendanceRecords.id, record.id));

  await recordAudit({ actorUserId: user.id, action: 'clock_out', entityType: 'attendance_record', entityId: record.id });

  revalidatePath('/attendance');
  revalidatePath('/dashboard');
  return { error: null };
}

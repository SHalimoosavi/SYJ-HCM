'use server';

import { db } from '@/db/client';
import { leaveRequests, leaveBalances } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireUserForAction, requireRoleForAction, ForbiddenError } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
import { validateDateRange, countInclusiveDays, hasOverlappingLeave, getRemainingBalance } from '@/lib/leave-rules';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';

export type LeaveFormState = { error: string | null };

export async function applyLeaveAction(_prevState: LeaveFormState, formData: FormData): Promise<LeaveFormState> {
  const user = await requireUserForAction();
  if (!user.employeeId) {
    return { error: 'Your account is not linked to an employee record. Contact HR.' };
  }

  const leaveTypeId = String(formData.get('leaveTypeId') || '');
  const startDate = String(formData.get('startDate') || '');
  const endDate = String(formData.get('endDate') || '');
  const reason = String(formData.get('reason') || '').trim() || null;

  if (!leaveTypeId || !startDate || !endDate) {
    return { error: 'Please fill in all required fields.' };
  }

  const dateError = validateDateRange(startDate, endDate);
  if (dateError) return { error: dateError };

  const days = countInclusiveDays(startDate, endDate);

  const overlaps = await hasOverlappingLeave(user.employeeId, startDate, endDate);
  if (overlaps) {
    return { error: 'This date range overlaps with an existing pending or approved leave request.' };
  }

  const year = new Date(`${startDate}T00:00:00.000Z`).getUTCFullYear();
  const balance = await getRemainingBalance(user.employeeId, leaveTypeId, year);
  if (!balance || balance.remaining < days) {
    return {
      error: balance
        ? `Insufficient leave balance. You have ${balance.remaining} day(s) remaining, but requested ${days}.`
        : 'No leave balance found for this leave type this year.'
    };
  }

  const id = nanoid();
  await db.insert(leaveRequests).values({
    id,
    employeeId: user.employeeId,
    leaveTypeId,
    startDate,
    endDate,
    days,
    reason,
    status: 'pending'
  });

  await recordAudit({ actorUserId: user.id, action: 'leave_requested', entityType: 'leave_request', entityId: id, metadata: { days } });

  revalidatePath('/leave');
  return { error: null };
}

export async function cancelLeaveAction(requestId: string): Promise<void> {
  const user = await requireUserForAction();

  const rows = await db.select().from(leaveRequests).where(eq(leaveRequests.id, requestId)).limit(1);
  const request = rows[0];
  if (!request) throw new Error('Leave request not found.');

  const isOwner = request.employeeId === user.employeeId;
  const isHrOrAdmin = user.role === 'admin' || user.role === 'hr';
  if (!isOwner && !isHrOrAdmin) {
    throw new ForbiddenError();
  }
  if (request.status !== 'pending') {
    throw new Error('Only pending requests can be cancelled.');
  }

  await db
    .update(leaveRequests)
    .set({ status: 'cancelled', updatedAt: new Date().toISOString() })
    .where(eq(leaveRequests.id, requestId));

  await recordAudit({ actorUserId: user.id, action: 'leave_cancelled', entityType: 'leave_request', entityId: requestId });

  revalidatePath('/leave');
}

export async function approveLeaveAction(requestId: string): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');

  const rows = await db.select().from(leaveRequests).where(eq(leaveRequests.id, requestId)).limit(1);
  const request = rows[0];
  if (!request) throw new Error('Leave request not found.');
  if (request.status !== 'pending') throw new Error('Only pending requests can be approved.');

  const year = new Date(`${request.startDate}T00:00:00.000Z`).getUTCFullYear();
  const balance = await getRemainingBalance(request.employeeId, request.leaveTypeId, year);
  if (!balance || balance.remaining < request.days) {
    throw new Error('Cannot approve: employee no longer has sufficient leave balance.');
  }

  await db
    .update(leaveRequests)
    .set({ status: 'approved', approverId: actor.id, approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(leaveRequests.id, requestId));

  const balanceRows = await db
    .select()
    .from(leaveBalances)
    .where(eq(leaveBalances.employeeId, request.employeeId));
  const target = balanceRows.find((b) => b.leaveTypeId === request.leaveTypeId && b.year === year);
  if (target) {
    await db
      .update(leaveBalances)
      .set({ used: target.used + request.days, updatedAt: new Date().toISOString() })
      .where(eq(leaveBalances.id, target.id));
  }

  await recordAudit({ actorUserId: actor.id, action: 'leave_approved', entityType: 'leave_request', entityId: requestId });

  revalidatePath('/leave');
  revalidatePath('/dashboard');
}

export async function rejectLeaveAction(requestId: string, formData: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');

  const rejectionReason = String(formData.get('rejectionReason') || '').trim();
  if (!rejectionReason) {
    throw new Error('A rejection reason is required.');
  }

  const rows = await db.select().from(leaveRequests).where(eq(leaveRequests.id, requestId)).limit(1);
  const request = rows[0];
  if (!request) throw new Error('Leave request not found.');
  if (request.status !== 'pending') throw new Error('Only pending requests can be rejected.');

  await db
    .update(leaveRequests)
    .set({
      status: 'rejected',
      approverId: actor.id,
      approvedAt: new Date().toISOString(),
      rejectionReason,
      updatedAt: new Date().toISOString()
    })
    .where(eq(leaveRequests.id, requestId));

  await recordAudit({ actorUserId: actor.id, action: 'leave_rejected', entityType: 'leave_request', entityId: requestId });

  revalidatePath('/leave');
}

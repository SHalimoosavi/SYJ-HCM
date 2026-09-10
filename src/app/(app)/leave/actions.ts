'use server';

import { sqlite, withSqliteTransactionSync } from '@/db/client';
import { requireUserForAction, requireRoleForAction, ForbiddenError } from '@/lib/auth';
import { recordAuditSync } from '@/lib/audit';
import { validateDateRange, countInclusiveDays } from '@/lib/leave-rules';
import { canCancelLeave } from '@/lib/authorization';
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
  const year = new Date(`${startDate}T00:00:00.000Z`).getUTCFullYear();
  const id = nanoid();

  try {
    withSqliteTransactionSync(() => {
      const overlap = sqlite
        .prepare(`
          SELECT 1
          FROM leave_requests
          WHERE organization_id = ?
            AND employee_id = ?
            AND status IN ('pending', 'approved')
            AND start_date <= ?
            AND end_date >= ?
          LIMIT 1
        `)
        .get(user.organizationId, user.employeeId, endDate, startDate);

      if (overlap) {
        throw new Error('This date range overlaps with an existing pending or approved leave request.');
      }

      const leaveType = sqlite
        .prepare('SELECT 1 FROM leave_types WHERE organization_id = ? AND id = ? LIMIT 1')
        .get(user.organizationId, leaveTypeId);
      if (!leaveType) throw new Error('Selected leave type is not part of your organization.');

      const balance = sqlite
        .prepare(`
          SELECT allocated, used
          FROM leave_balances
          WHERE organization_id = ? AND employee_id = ? AND leave_type_id = ? AND year = ?
          LIMIT 1
        `)
        .get(user.organizationId, user.employeeId, leaveTypeId, year) as { allocated: number; used: number } | undefined;

      if (!balance || balance.allocated - balance.used < days) {
        throw new Error(
          balance
            ? `Insufficient leave balance. You have ${balance.allocated - balance.used} day(s) remaining, but requested ${days}.`
            : 'No leave balance found for this leave type this year.'
        );
      }

      sqlite
        .prepare(`
          INSERT INTO leave_requests
            (id, organization_id, employee_id, leave_type_id, start_date, end_date, days, reason, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `)
        .run(id, user.organizationId, user.employeeId, leaveTypeId, startDate, endDate, days, reason);

      recordAuditSync({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'leave_requested',
        entityType: 'leave_request',
        entityId: id,
        metadata: { days }
      });
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to submit leave request.' };
  }

  revalidatePath('/leave');
  return { error: null };
}

export async function cancelLeaveAction(requestId: string): Promise<void> {
  const user = await requireUserForAction();

  withSqliteTransactionSync(() => {
    const request = sqlite
      .prepare('SELECT organization_id, employee_id, status FROM leave_requests WHERE organization_id = ? AND id = ? LIMIT 1')
      .get(user.organizationId, requestId) as { organization_id: string; employee_id: string; status: string } | undefined;

    if (!request) throw new Error('Leave request not found.');
    if (request.organization_id !== user.organizationId) throw new ForbiddenError();
    const targetEmployee = sqlite
      .prepare('SELECT 1 FROM employees WHERE organization_id = ? AND id = ? LIMIT 1')
      .get(user.organizationId, request.employee_id);
    if (!targetEmployee) throw new ForbiddenError();
    if (!canCancelLeave(user.role, user.employeeId, request.employee_id, user.organizationId, request.organization_id)) throw new ForbiddenError();
    if (request.status !== 'pending') throw new Error('Only pending requests can be cancelled.');

    const result = sqlite
      .prepare(`
        UPDATE leave_requests
        SET status = 'cancelled', updated_at = ?
        WHERE organization_id = ? AND id = ? AND status = 'pending'
      `)
      .run(new Date().toISOString(), user.organizationId, requestId);

    if (Number(result.changes) !== 1) {
      throw new Error('Only pending requests can be cancelled.');
    }

    recordAuditSync({ organizationId: user.organizationId, actorUserId: user.id, action: 'leave_cancelled', entityType: 'leave_request', entityId: requestId });
  });

  revalidatePath('/leave');
}

export async function approveLeaveAction(requestId: string): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');

  withSqliteTransactionSync(() => {
    const request = sqlite
      .prepare(`
        SELECT organization_id, employee_id, leave_type_id, start_date, end_date, days, status
        FROM leave_requests
        WHERE organization_id = ? AND id = ?
        LIMIT 1
      `)
      .get(actor.organizationId, requestId) as {
        organization_id: string;
        employee_id: string;
        leave_type_id: string;
        start_date: string;
        end_date: string;
        days: number;
        status: string;
      } | undefined;

    if (!request) throw new Error('Leave request not found.');
    if (request.organization_id !== actor.organizationId) throw new ForbiddenError();
    if (request.status !== 'pending') throw new Error('Only pending requests can be approved.');

    const relationshipValid = sqlite
      .prepare(`
        SELECT
          EXISTS(SELECT 1 FROM leave_types WHERE organization_id = ? AND id = ?) AS leave_type_ok,
          EXISTS(SELECT 1 FROM employees WHERE organization_id = ? AND id = ?) AS employee_ok
      `)
      .get(actor.organizationId, request.leave_type_id, actor.organizationId, request.employee_id) as { leave_type_ok: number; employee_ok: number };
    if (!relationshipValid.leave_type_ok || !relationshipValid.employee_ok) {
      throw new ForbiddenError('Leave record does not belong to this organization.');
    }

    const overlap = sqlite
      .prepare(`
        SELECT 1
        FROM leave_requests
        WHERE organization_id = ?
          AND employee_id = ?
          AND id <> ?
          AND status IN ('pending', 'approved')
          AND start_date <= ?
          AND end_date >= ?
        LIMIT 1
      `)
      .get(actor.organizationId, request.employee_id, requestId, request.end_date, request.start_date);

    if (overlap) throw new Error('Cannot approve: the requested dates now overlap another pending or approved leave.');

    const balanceUpdate = sqlite
      .prepare(`
        UPDATE leave_balances
        SET used = used + ?, updated_at = ?
        WHERE organization_id = ?
          AND employee_id = ?
          AND leave_type_id = ?
          AND year = ?
          AND allocated - used >= ?
      `)
      .run(
        request.days,
        new Date().toISOString(),
        actor.organizationId,
        request.employee_id,
        request.leave_type_id,
        new Date(`${request.start_date}T00:00:00.000Z`).getUTCFullYear(),
        request.days
      );

    if (Number(balanceUpdate.changes) !== 1) {
      throw new Error('Cannot approve: employee no longer has sufficient leave balance.');
    }

    const now = new Date().toISOString();
    const requestUpdate = sqlite
      .prepare(`
        UPDATE leave_requests
        SET status = 'approved', approver_id = ?, approved_at = ?, updated_at = ?
        WHERE organization_id = ? AND id = ? AND status = 'pending'
      `)
      .run(actor.id, now, now, actor.organizationId, requestId);

    if (Number(requestUpdate.changes) !== 1) {
      throw new Error('Only pending requests can be approved.');
    }

    recordAuditSync({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'leave_approved', entityType: 'leave_request', entityId: requestId });
  });

  revalidatePath('/leave');
  revalidatePath('/dashboard');
}

export async function rejectLeaveAction(requestId: string, formData: FormData): Promise<void> {
  const actor = await requireRoleForAction('admin', 'hr');

  const rejectionReason = String(formData.get('rejectionReason') || '').trim();
  if (!rejectionReason) throw new Error('A rejection reason is required.');

  withSqliteTransactionSync(() => {
    const result = sqlite
      .prepare(`
        UPDATE leave_requests
        SET status = 'rejected', approver_id = ?, approved_at = ?, rejection_reason = ?, updated_at = ?
        WHERE organization_id = ? AND id = ? AND status = 'pending'
      `)
      .run(actor.id, new Date().toISOString(), rejectionReason, new Date().toISOString(), actor.organizationId, requestId);

    if (Number(result.changes) !== 1) {
      const exists = sqlite.prepare('SELECT 1 FROM leave_requests WHERE organization_id = ? AND id = ? LIMIT 1').get(actor.organizationId, requestId);
      if (!exists) throw new Error('Leave request not found.');
      throw new Error('Only pending requests can be rejected.');
    }

    recordAuditSync({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'leave_rejected', entityType: 'leave_request', entityId: requestId });
  });

  revalidatePath('/leave');
}

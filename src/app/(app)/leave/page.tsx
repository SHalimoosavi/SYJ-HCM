import { requireUser, isHrOrAdmin } from '@/lib/auth';
import { db } from '@/db/client';
import { leaveRequests, leaveTypes, employees } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { ApplyLeaveForm } from './apply-leave-form';
import { CancelButton, ApproveButton, RejectForm } from './leave-actions-client';
import { leaveStatusBadgeClass, formatDate } from '@/lib/format';

export default async function LeavePage() {
  const user = await requireUser();
  const types = await db.select().from(leaveTypes).where(eq(leaveTypes.organizationId, user.organizationId));

  const myRequests = user.employeeId
    ? await db
        .select({
          id: leaveRequests.id,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          days: leaveRequests.days,
          status: leaveRequests.status,
          reason: leaveRequests.reason,
          rejectionReason: leaveRequests.rejectionReason,
          leaveTypeName: leaveTypes.name
        })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(and(eq(leaveRequests.organizationId, user.organizationId), eq(leaveRequests.employeeId, user.employeeId), eq(leaveTypes.organizationId, user.organizationId)))
        .orderBy(desc(leaveRequests.createdAt))
    : [];

  const pendingForApproval = isHrOrAdmin(user.role)
    ? await db
        .select({
          id: leaveRequests.id,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          days: leaveRequests.days,
          reason: leaveRequests.reason,
          leaveTypeName: leaveTypes.name,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName
        })
        .from(leaveRequests)
        .innerJoin(leaveTypes, and(eq(leaveRequests.leaveTypeId, leaveTypes.id), eq(leaveRequests.organizationId, leaveTypes.organizationId)))
        .innerJoin(employees, and(eq(leaveRequests.employeeId, employees.id), eq(leaveRequests.organizationId, employees.organizationId)))
        .where(and(eq(leaveRequests.organizationId, user.organizationId), eq(leaveTypes.organizationId, user.organizationId), eq(employees.organizationId, user.organizationId), eq(leaveRequests.status, 'pending')))
        .orderBy(desc(leaveRequests.createdAt))
    : [];

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-surface-900">Leave</h1>
        <p className="text-sm text-surface-500 mt-1">Apply for leave and track your requests.</p>
      </div>

      {user.employeeId && (
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-surface-900 mb-4">Apply for Leave</h2>
          <ApplyLeaveForm leaveTypes={types} />
        </div>
      )}

      {isHrOrAdmin(user.role) && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-surface-900 mb-4">Pending Approvals ({pendingForApproval.length})</h2>
          {pendingForApproval.length === 0 ? (
            <p className="text-sm text-surface-400 italic">Nothing pending approval.</p>
          ) : (
            <ul className="space-y-4">
              {pendingForApproval.map((r) => (
                <li key={r.id} className="border border-surface-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-surface-900">
                        {r.employeeFirstName} {r.employeeLastName} · {r.leaveTypeName}
                      </p>
                      <p className="text-sm text-surface-600 mt-0.5">
                        {formatDate(r.startDate)} – {formatDate(r.endDate)} ({r.days} day{r.days === 1 ? '' : 's'})
                      </p>
                      {r.reason && <p className="text-sm text-surface-500 mt-1">"{r.reason}"</p>}
                    </div>
                    <div className="flex flex-col gap-2 items-end shrink-0">
                      <ApproveButton requestId={r.id} />
                      <RejectForm requestId={r.id} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {user.employeeId && (
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-surface-900 p-5 pb-0">My Leave History</h2>
          {myRequests.length === 0 ? (
            <p className="text-sm text-surface-400 italic p-5">No leave requests yet.</p>
          ) : (
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="border-b border-surface-200 text-left text-xs font-medium text-surface-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Dates</th>
                  <th className="px-5 py-3">Days</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {myRequests.map((r) => (
                  <tr key={r.id} className="border-b border-surface-100 last:border-0">
                    <td className="px-5 py-3 text-surface-800">{r.leaveTypeName}</td>
                    <td className="px-5 py-3 text-surface-600">
                      {formatDate(r.startDate)} – {formatDate(r.endDate)}
                    </td>
                    <td className="px-5 py-3 text-surface-600">{r.days}</td>
                    <td className="px-5 py-3">
                      <span className={leaveStatusBadgeClass(r.status)}>{r.status}</span>
                      {r.status === 'rejected' && r.rejectionReason && (
                        <p className="text-xs text-surface-500 mt-1">Reason: {r.rejectionReason}</p>
                      )}
                    </td>
                    <td className="px-5 py-3">{r.status === 'pending' && <CancelButton requestId={r.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

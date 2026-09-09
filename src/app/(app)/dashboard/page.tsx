import { requireUser } from '@/lib/auth';
import { db } from '@/db/client';
import { employees, departments, leaveRequests, attendanceRecords, auditLogs, users } from '@/db/schema';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { formatDateTime } from '@/lib/format';
import Link from 'next/link';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const user = await requireUser();
  const today = todayStr();

  const allEmployees = await db.select().from(employees);
  const activeEmployees = allEmployees.filter((e) => e.employmentStatus === 'active');

  const [approvedLeaveToday, pendingLeaveRequests, presentTodayRecords, allDepartments, recentAudit] =
    await Promise.all([
      db
        .select()
        .from(leaveRequests)
        .where(
          and(eq(leaveRequests.status, 'approved'), lte(leaveRequests.startDate, today), gte(leaveRequests.endDate, today))
        ),
      db.select().from(leaveRequests).where(eq(leaveRequests.status, 'pending')),
      db.select().from(attendanceRecords).where(and(eq(attendanceRecords.workDate, today), eq(attendanceRecords.status, 'present'))),
      db.select().from(departments),
      db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          createdAt: auditLogs.createdAt,
          actorEmail: users.email
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.actorUserId, users.id))
        .orderBy(desc(auditLogs.createdAt))
        .limit(8)
    ]);

  const onLeaveTodayCount = approvedLeaveToday.length;
  const presentTodayCount = presentTodayRecords.length;
  const absentTodayCount = Math.max(activeEmployees.length - presentTodayCount - onLeaveTodayCount, 0);

  const deptBreakdown = allDepartments.map((dept) => ({
    name: dept.name,
    count: allEmployees.filter((e) => e.departmentId === dept.id).length
  }));

  const upcomingLeave = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.status, 'approved'), gte(leaveRequests.startDate, today)))
    .orderBy(leaveRequests.startDate)
    .limit(5);

  const stats = [
    { label: 'Total Employees', value: allEmployees.length },
    { label: 'Active Employees', value: activeEmployees.length },
    { label: 'Present Today', value: presentTodayCount },
    { label: 'On Leave Today', value: onLeaveTodayCount },
    { label: 'Absent Today', value: absentTodayCount },
    { label: 'Pending Leave Requests', value: pendingLeaveRequests.length }
  ];

  return (
    <div className="space-y-8 max-w-6xl">
      <div>
        <h1 className="text-2xl font-semibold text-surface-900">Welcome back, {user.email.split('@')[0]}</h1>
        <p className="text-sm text-surface-500 mt-1">Here's what's happening across your organization today.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xs font-medium text-surface-500">{s.label}</p>
            <p className="text-2xl font-semibold text-surface-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold text-surface-900 mb-4">Department Breakdown</h2>
          {deptBreakdown.length === 0 ? (
            <EmptyState message="No departments yet." />
          ) : (
            <ul className="space-y-3">
              {deptBreakdown.map((d) => (
                <li key={d.name} className="flex items-center justify-between text-sm">
                  <span className="text-surface-700">{d.name}</span>
                  <span className="font-medium text-surface-900">{d.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold text-surface-900 mb-4">Upcoming Approved Leave</h2>
          {upcomingLeave.length === 0 ? (
            <EmptyState message="No upcoming leave scheduled." />
          ) : (
            <ul className="space-y-3">
              {upcomingLeave.map((l) => (
                <li key={l.id} className="text-sm">
                  <p className="text-surface-800">
                    {l.startDate} – {l.endDate}
                  </p>
                  <p className="text-xs text-surface-500">{l.days} day(s)</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold text-surface-900 mb-4">Recent Activity</h2>
          {recentAudit.length === 0 ? (
            <EmptyState message="No activity recorded yet." />
          ) : (
            <ul className="space-y-3">
              {recentAudit.map((a) => (
                <li key={a.id} className="text-sm">
                  <p className="text-surface-800">
                    <span className="font-medium">{a.actorEmail ?? 'System'}</span> {a.action.replace(/_/g, ' ')}{' '}
                    {a.entityType}
                  </p>
                  <p className="text-xs text-surface-500">{formatDateTime(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {allEmployees.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-surface-700 font-medium">Your workspace is empty.</p>
          <p className="text-sm text-surface-500 mt-1">Add your first employee to get started.</p>
          <Link href="/employees/new" className="btn-primary mt-4 inline-flex">
            Add Employee
          </Link>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-surface-400 italic">{message}</p>;
}

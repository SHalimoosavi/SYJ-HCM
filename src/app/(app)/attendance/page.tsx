import { requireUser, isHrOrAdmin } from '@/lib/auth';
import { db } from '@/db/client';
import { attendanceRecords, employees } from '@/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { ClockWidget } from './clock-widget';
import { attendanceStatusBadgeClass, formatDateTime } from '@/lib/format';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function AttendancePage() {
  const user = await requireUser();
  const workDate = todayStr();

  const todayRecord = user.employeeId
    ? (
        await db
          .select()
          .from(attendanceRecords)
          .where(and(eq(attendanceRecords.employeeId, user.employeeId), eq(attendanceRecords.workDate, workDate)))
          .limit(1)
      )[0] || null
    : null;

  const myHistory = user.employeeId
    ? await db
        .select()
        .from(attendanceRecords)
        .where(eq(attendanceRecords.employeeId, user.employeeId))
        .orderBy(desc(attendanceRecords.workDate))
        .limit(30)
    : [];

  const orgToday = isHrOrAdmin(user.role)
    ? await db
        .select({
          id: attendanceRecords.id,
          clockInAt: attendanceRecords.clockInAt,
          clockOutAt: attendanceRecords.clockOutAt,
          status: attendanceRecords.status,
          firstName: employees.firstName,
          lastName: employees.lastName,
          designation: employees.designation
        })
        .from(attendanceRecords)
        .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
        .where(eq(attendanceRecords.workDate, workDate))
    : [];

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-surface-900">Attendance</h1>
        <p className="text-sm text-surface-500 mt-1">Clock in and out, and review your attendance history.</p>
      </div>

      {user.employeeId && (
        <div className="card p-6">
          <ClockWidget
            clockedIn={Boolean(todayRecord?.clockInAt)}
            clockedOut={Boolean(todayRecord?.clockOutAt)}
            clockInAt={todayRecord?.clockInAt || null}
            clockOutAt={todayRecord?.clockOutAt || null}
          />
        </div>
      )}

      {isHrOrAdmin(user.role) && (
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-surface-900 p-5 pb-0">Today Across the Organization</h2>
          {orgToday.length === 0 ? (
            <p className="text-sm text-surface-400 italic p-5">No attendance recorded yet today.</p>
          ) : (
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="border-b border-surface-200 text-left text-xs font-medium text-surface-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Employee</th>
                  <th className="px-5 py-3">Clock In</th>
                  <th className="px-5 py-3">Clock Out</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {orgToday.map((r) => (
                  <tr key={r.id} className="border-b border-surface-100 last:border-0">
                    <td className="px-5 py-3 text-surface-800">
                      {r.firstName} {r.lastName}
                      <p className="text-xs text-surface-500">{r.designation}</p>
                    </td>
                    <td className="px-5 py-3 text-surface-600">{formatDateTime(r.clockInAt)}</td>
                    <td className="px-5 py-3 text-surface-600">{formatDateTime(r.clockOutAt)}</td>
                    <td className="px-5 py-3">
                      <span className={attendanceStatusBadgeClass(r.status)}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {user.employeeId && (
        <div className="card overflow-x-auto">
          <h2 className="text-sm font-semibold text-surface-900 p-5 pb-0">My Attendance History</h2>
          {myHistory.length === 0 ? (
            <p className="text-sm text-surface-400 italic p-5">No attendance records yet.</p>
          ) : (
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="border-b border-surface-200 text-left text-xs font-medium text-surface-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Clock In</th>
                  <th className="px-5 py-3">Clock Out</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {myHistory.map((r) => (
                  <tr key={r.id} className="border-b border-surface-100 last:border-0">
                    <td className="px-5 py-3 text-surface-800">{r.workDate}</td>
                    <td className="px-5 py-3 text-surface-600">{formatDateTime(r.clockInAt)}</td>
                    <td className="px-5 py-3 text-surface-600">{formatDateTime(r.clockOutAt)}</td>
                    <td className="px-5 py-3">
                      <span className={attendanceStatusBadgeClass(r.status)}>{r.status}</span>
                    </td>
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

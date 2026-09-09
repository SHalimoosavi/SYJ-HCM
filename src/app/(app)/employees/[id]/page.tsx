import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/db/client';
import { employees, departments, leaveBalances, leaveTypes } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { EditEmployeeForm } from './edit-employee-form';
import { setEmployeeStatusAction } from '../actions';
import { employmentStatusBadgeClass, formatDate } from '@/lib/format';

export default async function EmployeeProfilePage({ params }: { params: { id: string } }) {
  await requireRole('admin', 'hr');

  const rows = await db.select().from(employees).where(eq(employees.id, params.id)).limit(1);
  const employee = rows[0];
  if (!employee) notFound();

  const allDepartments = await db.select().from(departments);

  const balances = await db
    .select({
      leaveTypeName: leaveTypes.name,
      allocated: leaveBalances.allocated,
      used: leaveBalances.used,
      year: leaveBalances.year
    })
    .from(leaveBalances)
    .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
    .where(eq(leaveBalances.employeeId, employee.id));

  const toggleAction =
    employee.employmentStatus === 'active'
      ? setEmployeeStatusAction.bind(null, employee.id, 'inactive')
      : setEmployeeStatusAction.bind(null, employee.id, 'active');

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-900">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            {employee.employeeCode} · {employee.designation}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={employmentStatusBadgeClass(employee.employmentStatus)}>{employee.employmentStatus}</span>
          <form action={toggleAction}>
            <button type="submit" className={employee.employmentStatus === 'active' ? 'btn-danger' : 'btn-secondary'}>
              {employee.employmentStatus === 'active' ? 'Deactivate' : 'Activate'}
            </button>
          </form>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-surface-900 mb-3">Leave Balances ({new Date().getFullYear()})</h2>
        {balances.length === 0 ? (
          <p className="text-sm text-surface-400 italic">No leave balances allocated yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {balances.map((b) => (
              <div key={b.leaveTypeName} className="rounded-lg border border-surface-200 p-3">
                <p className="text-xs text-surface-500">{b.leaveTypeName}</p>
                <p className="text-lg font-semibold text-surface-900">
                  {b.allocated - b.used} <span className="text-xs font-normal text-surface-500">/ {b.allocated} days left</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-surface-900 mb-4">Edit Details</h2>
        <EditEmployeeForm employee={employee} departments={allDepartments} />
      </div>

      <div className="card p-5 text-sm text-surface-500">
        <p>Joined {formatDate(employee.dateOfJoining)}</p>
        <p>Work email: {employee.workEmail}</p>
      </div>
    </div>
  );
}

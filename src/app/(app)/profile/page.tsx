import { requireUser } from '@/lib/auth';
import { db } from '@/db/client';
import { employees, departments, leaveBalances, leaveTypes } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { ChangePasswordForm } from './change-password-form';
import { SessionManagementForm } from './session-management-form';
import { formatDate } from '@/lib/format';

export default async function ProfilePage() {
  const user = await requireUser();

  const employee = user.employeeId
    ? (
        await db
          .select({
            firstName: employees.firstName,
            lastName: employees.lastName,
            workEmail: employees.workEmail,
            phone: employees.phone,
            designation: employees.designation,
            dateOfJoining: employees.dateOfJoining,
            location: employees.location,
            departmentName: departments.name
          })
          .from(employees)
          .leftJoin(departments, and(eq(employees.departmentId, departments.id), eq(employees.organizationId, departments.organizationId)))
          .where(and(eq(employees.organizationId, user.organizationId), eq(employees.id, user.employeeId)))
          .limit(1)
      )[0]
    : null;

  const balances = user.employeeId
    ? await db
        .select({
          leaveTypeName: leaveTypes.name,
          allocated: leaveBalances.allocated,
          used: leaveBalances.used
        })
        .from(leaveBalances)
        .innerJoin(leaveTypes, and(eq(leaveBalances.leaveTypeId, leaveTypes.id), eq(leaveBalances.organizationId, leaveTypes.organizationId)))
        .where(and(eq(leaveBalances.organizationId, user.organizationId), eq(leaveTypes.organizationId, user.organizationId), eq(leaveBalances.employeeId, user.employeeId)))
    : [];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-surface-900">My Profile</h1>
        <p className="text-sm text-surface-500 mt-1">Your personal information and account settings.</p>
      </div>

      {employee ? (
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-surface-900 mb-4">Employment Information</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Name" value={`${employee.firstName} ${employee.lastName}`} />
            <Field label="Work Email" value={employee.workEmail} />
            <Field label="Designation" value={employee.designation} />
            <Field label="Department" value={employee.departmentName || '—'} />
            <Field label="Location" value={employee.location || '—'} />
            <Field label="Joined" value={formatDate(employee.dateOfJoining)} />
            <Field label="Phone" value={employee.phone || '—'} />
          </dl>
        </div>
      ) : (
        <div className="card p-6">
          <p className="text-sm text-surface-500 italic">
            Your account is not linked to an employee record. Contact HR to complete your profile.
          </p>
        </div>
      )}

      {balances.length > 0 && (
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-surface-900 mb-4">Leave Balance ({new Date().getFullYear()})</h2>
          <div className="grid grid-cols-2 gap-4">
            {balances.map((b) => (
              <div key={b.leaveTypeName} className="rounded-lg border border-surface-200 p-3">
                <p className="text-xs text-surface-500">{b.leaveTypeName}</p>
                <p className="text-lg font-semibold text-surface-900">
                  {b.allocated - b.used} <span className="text-xs font-normal text-surface-500">/ {b.allocated} days left</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-surface-900 mb-4">Change Password</h2>
        <ChangePasswordForm />
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-surface-900 mb-4">Session Security</h2>
        <SessionManagementForm />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-surface-500">{label}</dt>
      <dd className="text-surface-900 font-medium mt-0.5">{value}</dd>
    </div>
  );
}

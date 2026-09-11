import { requireRole } from '@/lib/auth';
import { getAvailableEmployeesForLinking, getOrganizationMembersForAdmin } from '@/lib/organization-management';
import { linkEmployeeAction, setMemberRoleAction, setMemberStatusAction } from '../actions';

export default async function OrganizationMembersPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireRole('admin');
  const [members, employees] = await Promise.all([
    getOrganizationMembersForAdmin(user),
    getAvailableEmployeesForLinking(user)
  ]);
  const params = await searchParams;

  return (
    <div className="max-w-6xl space-y-6">
      <div><p className="text-sm font-medium text-brand-600">Organization administration</p><h1 className="mt-1 text-2xl font-semibold">Members</h1><p className="mt-1 text-sm text-surface-500">Manage accounts that belong to your organization. Cross-organization membership changes are not supported.</p></div>
      {params.error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{params.error}</div> : null}
      {params.saved ? <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">Member change saved.</div> : null}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-surface-200 text-sm">
            <thead className="bg-surface-50"><tr><th className="px-5 py-3 text-left font-medium text-surface-600">Member</th><th className="px-5 py-3 text-left font-medium text-surface-600">Role</th><th className="px-5 py-3 text-left font-medium text-surface-600">Employee link</th><th className="px-5 py-3 text-left font-medium text-surface-600">Status</th><th className="px-5 py-3 text-right font-medium text-surface-600">Actions</th></tr></thead>
            <tbody className="divide-y divide-surface-100 bg-white">
              {members.map((member) => {
                const employeeName = member.employeeFirstName && member.employeeLastName ? `${member.employeeFirstName} ${member.employeeLastName}` : 'Not linked';
                return <tr key={member.id}>
                  <td className="px-5 py-4"><p className="font-medium text-surface-900">{member.email}</p><p className="text-xs text-surface-500">{member.id}</p></td>
                  <td className="px-5 py-4">
                    {member.id === user.id ? <span className="badge-gray">{member.role}</span> : <form action={setMemberRoleAction} className="flex items-center gap-2"><input type="hidden" name="userId" value={member.id} /><select className="input max-w-36 py-1.5" name="role" defaultValue={member.role}><option value="admin">Admin</option><option value="hr">HR</option><option value="employee">Employee</option></select><button className="btn-secondary px-3 py-1.5 text-xs" type="submit">Save</button></form>}
                  </td>
                  <td className="px-5 py-4"><form action={linkEmployeeAction} className="flex min-w-64 items-center gap-2"><input type="hidden" name="userId" value={member.id} /><select className="input py-1.5" name="employeeId" defaultValue={member.employeeId ?? ''}><option value="">Not linked</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} — {employee.firstName} {employee.lastName}</option>)}</select><button className="btn-secondary px-3 py-1.5 text-xs" type="submit">Save</button></form><p className="mt-1 text-xs text-surface-500">{employeeName}</p></td>
                  <td className="px-5 py-4">{member.isActive ? <span className="badge-green">Active</span> : <span className="badge-gray">Inactive</span>}</td>
                  <td className="px-5 py-4 text-right">{member.id === user.id ? <span className="text-xs text-surface-400">Current account</span> : <form action={setMemberStatusAction}><input type="hidden" name="userId" value={member.id} /><input type="hidden" name="isActive" value={member.isActive ? 'false' : 'true'} /><button className={member.isActive ? 'btn-danger px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'} type="submit">{member.isActive ? 'Deactivate' : 'Activate'}</button></form>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

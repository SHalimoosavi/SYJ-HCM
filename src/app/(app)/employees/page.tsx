import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/db/client';
import { employees, departments } from '@/db/schema';
import { and, eq, like, or, asc, desc } from 'drizzle-orm';
import { employmentStatusBadgeClass } from '@/lib/format';

const PAGE_SIZE = 20;

type SearchParams = {
  q?: string;
  department?: string;
  status?: string;
  sort?: string;
  page?: string;
};

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireRole('admin', 'hr');

  const resolvedSearchParams = await searchParams;
  const q = resolvedSearchParams.q?.trim() || '';
  const departmentFilter = resolvedSearchParams.department || '';
  const statusFilter = resolvedSearchParams.status || '';
  const sort = resolvedSearchParams.sort || 'name_asc';
  const page = Math.max(parseInt(resolvedSearchParams.page || '1', 10) || 1, 1);

  const allDepartments = await db.select().from(departments).where(eq(departments.organizationId, user.organizationId));

  const conditions = [eq(employees.organizationId, user.organizationId)];
  if (q) {
    const searchCondition = or(
      like(employees.firstName, `%${q}%`),
      like(employees.lastName, `%${q}%`),
      like(employees.workEmail, `%${q}%`),
      like(employees.employeeCode, `%${q}%`)
    );
    if (searchCondition) conditions.push(searchCondition);
  }
  if (departmentFilter) {
    conditions.push(eq(employees.departmentId, departmentFilter));
  }
  if (statusFilter === 'active' || statusFilter === 'inactive') {
    conditions.push(eq(employees.employmentStatus, statusFilter));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const orderBy =
    sort === 'name_desc'
      ? [desc(employees.firstName)]
      : sort === 'joined_desc'
        ? [desc(employees.dateOfJoining)]
        : sort === 'joined_asc'
          ? [asc(employees.dateOfJoining)]
          : [asc(employees.firstName)];

  const all = await db
    .select()
    .from(employees)
    .where(whereClause)
    .orderBy(...orderBy);

  const total = all.length;
  const pageItems = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const deptMap = new Map(allDepartments.map((d) => [d.id, d.name]));

  function buildQuery(overrides: Partial<SearchParams>) {
    const params = new URLSearchParams();
    const merged = { q, department: departmentFilter, status: statusFilter, sort, page: String(page), ...overrides };
    Object.entries(merged).forEach(([k, v]) => {
      if (v) params.set(k, String(v));
    });
    return `?${params.toString()}`;
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-900">Employees</h1>
          <p className="text-sm text-surface-500 mt-1">{total} total</p>
        </div>
        <Link href="/employees/new" className="btn-primary">
          Add Employee
        </Link>
      </div>

      <form className="card p-4 flex flex-wrap gap-3 items-end" method="get">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Search</label>
          <input className="input" type="text" name="q" defaultValue={q} placeholder="Name, email, code…" />
        </div>
        <div>
          <label className="label">Department</label>
          <select className="input" name="department" defaultValue={departmentFilter}>
            <option value="">All</option>
            {allDepartments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" name="status" defaultValue={statusFilter}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div>
          <label className="label">Sort</label>
          <select className="input" name="sort" defaultValue={sort}>
            <option value="name_asc">Name (A–Z)</option>
            <option value="name_desc">Name (Z–A)</option>
            <option value="joined_desc">Newest hires</option>
            <option value="joined_asc">Oldest hires</option>
          </select>
        </div>
        <button type="submit" className="btn-secondary">
          Apply
        </button>
      </form>

      <div className="card overflow-x-auto">
        {pageItems.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-surface-700 font-medium">No employees match your filters.</p>
            <p className="text-sm text-surface-500 mt-1">Try adjusting search or filters, or add a new employee.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 text-left text-xs font-medium text-surface-500 uppercase tracking-wide">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((e) => (
                <tr key={e.id} className="border-b border-surface-100 last:border-0 hover:bg-surface-50">
                  <td className="px-4 py-3">
                    <Link href={`/employees/${e.id}`} className="font-medium text-brand-600 hover:underline">
                      {e.firstName} {e.lastName}
                    </Link>
                    <p className="text-xs text-surface-500">{e.workEmail}</p>
                  </td>
                  <td className="px-4 py-3 text-surface-700">{deptMap.get(e.departmentId || '') || '—'}</td>
                  <td className="px-4 py-3 text-surface-700">{e.designation}</td>
                  <td className="px-4 py-3">
                    <span className={employmentStatusBadgeClass(e.employmentStatus)}>{e.employmentStatus}</span>
                  </td>
                  <td className="px-4 py-3 text-surface-500">{e.dateOfJoining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-surface-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={buildQuery({ page: String(page - 1) })} className="btn-secondary">
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link href={buildQuery({ page: String(page + 1) })} className="btn-secondary">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

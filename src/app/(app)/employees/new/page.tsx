import { requireRole } from '@/lib/auth';
import { db } from '@/db/client';
import { departments } from '@/db/schema';
import { NewEmployeeForm } from './new-employee-form';

export default async function NewEmployeePage() {
  await requireRole('admin', 'hr');
  const allDepartments = await db.select().from(departments);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-surface-900 mb-6">Add Employee</h1>
      <div className="card p-6">
        <NewEmployeeForm departments={allDepartments} />
      </div>
    </div>
  );
}

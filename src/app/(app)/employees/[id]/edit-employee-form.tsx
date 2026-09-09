'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { updateEmployeeAction, type EmployeeFormState } from '../actions';
import type { Employee } from '@/db/schema';

const initialState: EmployeeFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save Changes'}
    </button>
  );
}

export function EditEmployeeForm({
  employee,
  departments
}: {
  employee: Employee;
  departments: { id: string; name: string }[];
}) {
  const boundAction = updateEmployeeAction.bind(null, employee.id);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">First Name *</label>
          <input className="input" name="firstName" defaultValue={employee.firstName} required />
        </div>
        <div>
          <label className="label">Last Name *</label>
          <input className="input" name="lastName" defaultValue={employee.lastName} required />
        </div>
        <div className="col-span-2">
          <label className="label">Work Email *</label>
          <input className="input" type="email" name="workEmail" defaultValue={employee.workEmail} required />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" name="phone" defaultValue={employee.phone || ''} />
        </div>
        <div>
          <label className="label">Location</label>
          <input className="input" name="location" defaultValue={employee.location || ''} />
        </div>
        <div>
          <label className="label">Department</label>
          <select className="input" name="departmentId" defaultValue={employee.departmentId || ''}>
            <option value="">— None —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Employment Type</label>
          <select className="input" name="employmentType" defaultValue={employee.employmentType}>
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Designation *</label>
          <input className="input" name="designation" defaultValue={employee.designation} required />
        </div>
        <div className="col-span-2">
          <label className="label">Address</label>
          <input className="input" name="address" defaultValue={employee.address || ''} />
        </div>
        <div>
          <label className="label">Emergency Contact Name</label>
          <input className="input" name="emergencyContactName" defaultValue={employee.emergencyContactName || ''} />
        </div>
        <div>
          <label className="label">Emergency Contact Phone</label>
          <input className="input" name="emergencyContactPhone" defaultValue={employee.emergencyContactPhone || ''} />
        </div>
      </div>

      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

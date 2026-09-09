'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createEmployeeAction, type EmployeeFormState } from '../actions';

const initialState: EmployeeFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Create Employee'}
    </button>
  );
}

export function NewEmployeeForm({ departments }: { departments: { id: string; name: string }[] }) {
  const [state, formAction] = useFormState(createEmployeeAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Employee Code *</label>
          <input className="input" name="employeeCode" required placeholder="EMP-0003" />
        </div>
        <div>
          <label className="label">Date of Joining *</label>
          <input className="input" type="date" name="dateOfJoining" required />
        </div>
        <div>
          <label className="label">First Name *</label>
          <input className="input" name="firstName" required />
        </div>
        <div>
          <label className="label">Last Name *</label>
          <input className="input" name="lastName" required />
        </div>
        <div className="col-span-2">
          <label className="label">Work Email *</label>
          <input className="input" type="email" name="workEmail" required />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" name="phone" />
        </div>
        <div>
          <label className="label">Location</label>
          <input className="input" name="location" placeholder="Hyderabad, India" />
        </div>
        <div>
          <label className="label">Department</label>
          <select className="input" name="departmentId" defaultValue="">
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
          <select className="input" name="employmentType" defaultValue="full_time">
            <option value="full_time">Full time</option>
            <option value="part_time">Part time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Designation *</label>
          <input className="input" name="designation" required placeholder="Software Engineer" />
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

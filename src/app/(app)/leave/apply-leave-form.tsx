'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { applyLeaveAction, type LeaveFormState } from './actions';

const initialState: LeaveFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Submitting…' : 'Submit Request'}
    </button>
  );
}

export function ApplyLeaveForm({ leaveTypes }: { leaveTypes: { id: string; name: string }[] }) {
  const [state, formAction] = useFormState(applyLeaveAction, initialState);

  if (leaveTypes.length === 0) {
    return <p className="text-sm text-surface-400 italic">No leave types configured yet. Contact HR.</p>;
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Leave Type *</label>
          <select className="input" name="leaveTypeId" required defaultValue="">
            <option value="" disabled>
              Select a leave type
            </option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Start Date *</label>
          <input className="input" type="date" name="startDate" required />
        </div>
        <div>
          <label className="label">End Date *</label>
          <input className="input" type="date" name="endDate" required />
        </div>
        <div className="col-span-2">
          <label className="label">Reason</label>
          <textarea className="input" name="reason" rows={2} />
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

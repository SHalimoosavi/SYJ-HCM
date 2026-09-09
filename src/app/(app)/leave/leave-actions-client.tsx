'use client';

import { useFormStatus } from 'react-dom';
import { useState } from 'react';
import { cancelLeaveAction, approveLeaveAction, rejectLeaveAction } from './actions';

function TinyButton({ children, className }: { children: React.ReactNode; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${className} text-xs px-3 py-1.5`} disabled={pending}>
      {pending ? '…' : children}
    </button>
  );
}

export function CancelButton({ requestId }: { requestId: string }) {
  const action = cancelLeaveAction.bind(null, requestId);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('Cancel this leave request?')) e.preventDefault();
      }}
    >
      <TinyButton className="btn-secondary">Cancel</TinyButton>
    </form>
  );
}

export function ApproveButton({ requestId }: { requestId: string }) {
  const action = approveLeaveAction.bind(null, requestId);
  return (
    <form action={action}>
      <TinyButton className="btn-primary">Approve</TinyButton>
    </form>
  );
}

export function RejectForm({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  const action = rejectLeaveAction.bind(null, requestId);

  if (!open) {
    return (
      <button type="button" className="btn-danger text-xs px-3 py-1.5" onClick={() => setOpen(true)}>
        Reject
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2 items-end">
      <input
        className="input text-xs"
        name="rejectionReason"
        placeholder="Reason for rejection"
        required
        style={{ width: 180 }}
      />
      <div className="flex gap-2">
        <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => setOpen(false)}>
          Back
        </button>
        <TinyButton className="btn-danger">Confirm Reject</TinyButton>
      </div>
    </form>
  );
}

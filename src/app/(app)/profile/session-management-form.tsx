'use client';

import { useState, useTransition } from 'react';
import { signOutOtherSessionsAction } from './actions';

export function SessionManagementForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function revokeOtherSessions() {
    setMessage(null);
    startTransition(async () => {
      const result = await signOutOtherSessionsAction();
      setMessage(result.count === 0 ? 'No other active sessions were found.' : `${result.count} other session${result.count === 1 ? '' : 's'} signed out.`);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-surface-500">
        Sign out browsers and devices other than this one. Your current session stays active.
      </p>
      <button type="button" className="btn-secondary" onClick={revokeOtherSessions} disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out other sessions'}
      </button>
      {message && <p className="text-sm text-surface-600" role="status">{message}</p>}
    </div>
  );
}

'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { changePasswordAction, type ChangePasswordState } from './actions';

const initialState: ChangePasswordState = { error: null, success: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Updating…' : 'Update Password'}
    </button>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useFormState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-4 max-w-sm">
      <div>
        <label className="label">Current Password</label>
        <input className="input" type="password" name="currentPassword" required autoComplete="current-password" />
      </div>
      <div>
        <label className="label">New Password</label>
        <input className="input" type="password" name="newPassword" required minLength={8} autoComplete="new-password" />
      </div>
      <div>
        <label className="label">Confirm New Password</label>
        <input className="input" type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" />
      </div>
      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}
      {state.success && <p className="text-sm text-green-600">Password updated successfully.</p>}
      <SubmitButton />
    </form>
  );
}

'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRef, useState } from 'react';
import { clockInAction, clockOutAction, type AttendanceActionState } from './actions';
import { formatDateTime } from '@/lib/format';

const initialState: AttendanceActionState = { error: null };

function ActionButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export function ClockWidget({
  clockedIn,
  clockedOut,
  clockInAt,
  clockOutAt
}: {
  clockedIn: boolean;
  clockedOut: boolean;
  clockInAt: string | null;
  clockOutAt: string | null;
}) {
  const [inState, inAction] = useFormState(clockInAction, initialState);
  const [outState, outAction] = useFormState(clockOutAction, initialState);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'>(
    'idle'
  );
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);

  function requestLocation(onDone: () => void) {
    if (!('geolocation' in navigator)) {
      setLocationStatus('unavailable');
      onDone();
      return;
    }
    setLocationStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (latRef.current) latRef.current.value = String(pos.coords.latitude);
        if (lngRef.current) lngRef.current.value = String(pos.coords.longitude);
        setLocationStatus('granted');
        onDone();
      },
      () => {
        // Permission denied or error - attendance still proceeds without location.
        setLocationStatus('denied');
        onDone();
      },
      { timeout: 8000 }
    );
  }

  if (clockedIn && clockedOut) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-surface-900 mb-2">Today's Attendance</h2>
        <p className="text-sm text-surface-600">
          Clocked in at {formatDateTime(clockInAt)}, clocked out at {formatDateTime(clockOutAt)}.
        </p>
        <span className="badge-green mt-2 inline-flex">Complete</span>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-surface-900 mb-4">Today's Attendance</h2>
      <div className="flex flex-wrap items-center gap-4">
        {!clockedIn && (
          <form
            action={inAction}
            onSubmit={(e) => {
              if (locationStatus === 'idle') {
                e.preventDefault();
                const form = e.currentTarget;
                requestLocation(() => form.requestSubmit());
              }
            }}
          >
            <input ref={latRef} type="hidden" name="lat" />
            <input ref={lngRef} type="hidden" name="lng" />
            <ActionButton label="Clock In" pendingLabel="Clocking in…" />
          </form>
        )}
        {clockedIn && !clockedOut && (
          <form
            action={outAction}
            onSubmit={(e) => {
              if (locationStatus === 'idle') {
                e.preventDefault();
                const form = e.currentTarget;
                requestLocation(() => form.requestSubmit());
              }
            }}
          >
            <input ref={latRef} type="hidden" name="lat" />
            <input ref={lngRef} type="hidden" name="lng" />
            <ActionButton label="Clock Out" pendingLabel="Clocking out…" />
          </form>
        )}
        {clockedIn && (
          <p className="text-sm text-surface-500">Clocked in at {formatDateTime(clockInAt)}</p>
        )}
      </div>
      {locationStatus === 'denied' && (
        <p className="text-xs text-surface-400 mt-2">Location unavailable or denied — proceeding without GPS.</p>
      )}
      {(inState.error || outState.error) && (
        <p className="text-sm text-red-600 mt-3" role="alert">
          {inState.error || outState.error}
        </p>
      )}
    </div>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function leaveStatusBadgeClass(status: string): string {
  switch (status) {
    case 'approved':
      return 'badge-green';
    case 'pending':
      return 'badge-amber';
    case 'rejected':
      return 'badge-red';
    default:
      return 'badge-gray';
  }
}

export function attendanceStatusBadgeClass(status: string): string {
  switch (status) {
    case 'present':
      return 'badge-green';
    case 'on_leave':
      return 'badge-amber';
    case 'absent':
      return 'badge-red';
    default:
      return 'badge-gray';
  }
}

export function employmentStatusBadgeClass(status: string): string {
  return status === 'active' ? 'badge-green' : 'badge-gray';
}

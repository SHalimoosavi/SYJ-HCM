import type { CurrentUser } from '@/lib/session';
import { logoutAction } from '@/app/(app)/logout-action';

export function Topbar({ user }: { user: CurrentUser }) {
  return (
    <header className="h-16 flex items-center justify-end px-4 md:px-8 border-b border-surface-200 bg-white">
      <div className="flex items-center gap-4">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-surface-900">{user.email}</p>
          <p className="text-xs text-surface-500 capitalize">{user.role}</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn-secondary text-xs">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

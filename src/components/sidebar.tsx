import Link from 'next/link';
import type { CurrentUser } from '@/lib/session';
import { isHrOrAdmin } from '@/lib/auth';

const baseLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/attendance', label: 'Attendance' },
  { href: '/leave', label: 'Leave' },
  { href: '/profile', label: 'My Profile' }
];

const hrLinks = [{ href: '/employees', label: 'Employees' }];

export function Sidebar({ user }: { user: CurrentUser }) {
  const links = isHrOrAdmin(user.role) ? [baseLinks[0], hrLinks[0], ...baseLinks.slice(1)] : baseLinks;

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col border-r border-surface-200 bg-white">
      <div className="h-16 flex items-center px-5 border-b border-surface-200">
        <div className="h-8 w-8 rounded-md bg-brand-600 text-white flex items-center justify-center font-semibold text-sm">
          S
        </div>
        <span className="ml-2.5 font-semibold text-surface-900">SYJ-HCM</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center rounded-lg px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-100 hover:text-surface-900"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="px-3 py-4 border-t border-surface-200">
        <Link
          href="/profile"
          className="flex items-center rounded-lg px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-100"
        >
          Settings
        </Link>
      </div>
    </aside>
  );
}

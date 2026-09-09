import { requireUser } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // This is the real authorization boundary: every route under (app) passes
  // through here, and requireUser() redirects to /login if there is no
  // valid, non-expired, DB-backed session. The edge middleware only handles
  // the fast-path UX redirect - this is what actually enforces access.
  const user = await requireUser();

  return (
    <div className="min-h-screen flex bg-surface-50">
      <Sidebar user={user} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar user={user} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

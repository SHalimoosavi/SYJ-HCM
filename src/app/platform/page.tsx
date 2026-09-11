import { requirePlatformAdmin } from '@/lib/auth';
import { getPlatformOverview } from '@/lib/platform';
import { provisionOrganizationAction, setOrganizationStatusAction } from './actions';

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const actor = await requirePlatformAdmin();
  const { organizations, audit } = await getPlatformOverview();
  const params = await searchParams;
  const active = organizations.filter((o) => o.status === 'active').length;
  const suspended = organizations.length - active;

  return <div className="max-w-7xl space-y-6">
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">SYJ-HCM Platform</p>
      <h1 className="mt-1 text-2xl font-semibold text-surface-900">Platform administration</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-surface-600">Platform operations are separate from organization administration. Your platform capability is granted server-side and is never derived from organization role or browser input.</p>
    </div>
    {params.error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{params.error}</div> : null}
    {params.saved ? <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">Platform operation completed successfully.</div> : null}
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="card p-5"><p className="text-xs font-medium uppercase tracking-wide text-surface-500">Organizations</p><p className="mt-2 text-2xl font-semibold">{organizations.length}</p></div>
      <div className="card p-5"><p className="text-xs font-medium uppercase tracking-wide text-surface-500">Active</p><p className="mt-2 text-2xl font-semibold">{active}</p></div>
      <div className="card p-5"><p className="text-xs font-medium uppercase tracking-wide text-surface-500">Suspended</p><p className="mt-2 text-2xl font-semibold">{suspended}</p></div>
    </div>
    <section className="card p-6">
      <div className="border-b border-surface-200 pb-4"><h2 className="text-lg font-semibold">Provision organization</h2><p className="mt-1 text-sm text-surface-500">Creates the organization, tenant defaults, and its first administrator atomically. No email is sent; securely hand the initial password to the administrator.</p></div>
      <form action={provisionOrganizationAction} className="mt-6 grid gap-5 sm:grid-cols-2">
        <div><label className="label" htmlFor="name">Organization name</label><input className="input" id="name" name="name" maxLength={100} required /></div>
        <div><label className="label" htmlFor="slug">Slug</label><input className="input" id="slug" name="slug" maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></div>
        <div><label className="label" htmlFor="adminEmail">Initial administrator email</label><input className="input" id="adminEmail" name="adminEmail" type="email" maxLength={254} required /></div>
        <div><label className="label" htmlFor="adminPassword">Initial administrator password</label><input className="input" id="adminPassword" name="adminPassword" type="password" minLength={12} maxLength={256} required /><p className="mt-1 text-xs text-surface-500">12–256 characters. The existing scrypt password architecture is used.</p></div>
        <div className="sm:col-span-2 flex justify-end"><button className="btn-primary" type="submit">Provision organization</button></div>
      </form>
    </section>
    <section className="card overflow-hidden">
      <div className="border-b border-surface-200 px-6 py-5"><h2 className="text-lg font-semibold">Organization inventory</h2><p className="mt-1 text-sm text-surface-500">Platform-level lifecycle controls. Tenant data is never deleted by these controls.</p></div>
      <div className="overflow-x-auto"><table className="min-w-full divide-y divide-surface-200 text-sm"><thead className="bg-surface-50"><tr><th className="px-6 py-3 text-left font-medium text-surface-600">Organization</th><th className="px-6 py-3 text-left font-medium text-surface-600">Members</th><th className="px-6 py-3 text-left font-medium text-surface-600">Status</th><th className="px-6 py-3 text-right font-medium text-surface-600">Lifecycle</th></tr></thead><tbody className="divide-y divide-surface-100 bg-white">{organizations.map((org) => <tr key={org.id}><td className="px-6 py-4"><p className="font-medium">{org.name}</p><p className="text-xs text-surface-500">{org.slug}</p></td><td className="px-6 py-4">{org.userCount}</td><td className="px-6 py-4"><span className={org.status === 'active' ? 'badge-green' : 'badge-red'}>{org.status}</span></td><td className="px-6 py-4 text-right"><form action={setOrganizationStatusAction}><input type="hidden" name="organizationId" value={org.id} /><input type="hidden" name="status" value={org.status === 'active' ? 'suspended' : 'active'} /><button className={org.status === 'active' ? 'btn-danger px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'} type="submit">{org.status === 'active' ? 'Suspend' : 'Reactivate'}</button></form></td></tr>)}</tbody></table></div>
    </section>
    <section className="card p-6"><h2 className="text-lg font-semibold">Recent platform audit</h2><div className="mt-4 space-y-3">{audit.slice(0, 10).map((entry) => <div key={entry.id} className="rounded-lg border border-surface-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{entry.action}</span><span className="text-xs text-surface-500">{entry.createdAt}</span></div><p className="mt-1 text-xs text-surface-500">{entry.entityType} / {entry.entityId} · actor {entry.actorUserId ?? 'system'}</p></div>)}{audit.length === 0 ? <p className="text-sm text-surface-500">No platform events recorded.</p> : null}</div></section>
  </div>;
}

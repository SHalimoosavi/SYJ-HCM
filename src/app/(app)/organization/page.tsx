import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getOrganizationForAdmin, getOrganizationMembersForAdmin } from '@/lib/organization-management';
import { updateOrganizationAction } from './actions';

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireRole('admin');
  const organization = await getOrganizationForAdmin(user);
  const members = await getOrganizationMembersForAdmin(user);
  const params = await searchParams;

  if (!organization) {
    return <div className="card p-6"><p className="text-sm text-red-700">Organization context could not be resolved.</p></div>;
  }

  const activeMembers = members.filter((member) => member.isActive).length;
  const adminCount = members.filter((member) => member.isActive && member.role === 'admin').length;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-medium text-brand-600">Organization administration</p>
        <h1 className="mt-1 text-2xl font-semibold text-surface-900">{organization.name}</h1>
        <p className="mt-1 text-sm text-surface-500">Manage the identity and members of your authenticated organization.</p>
      </div>

      {params.error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{params.error}</div> : null}
      {params.saved ? <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">Organization details saved.</div> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-xs font-medium uppercase tracking-wide text-surface-500">Status</p><p className="mt-2"><span className={organization.status === 'active' ? 'badge-green' : 'badge-red'}>{organization.status}</span></p></div>
        <div className="card p-5"><p className="text-xs font-medium uppercase tracking-wide text-surface-500">Active members</p><p className="mt-2 text-2xl font-semibold">{activeMembers}</p></div>
        <div className="card p-5"><p className="text-xs font-medium uppercase tracking-wide text-surface-500">Active administrators</p><p className="mt-2 text-2xl font-semibold">{adminCount}</p></div>
      </div>

      <section className="card p-6">
        <div className="flex flex-col gap-2 border-b border-surface-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-lg font-semibold">Organization identity</h2><p className="text-sm text-surface-500">These values identify your tenant across the application.</p></div>
          <Link href="/organization/members" className="btn-secondary">Manage members</Link>
        </div>
        <form action={updateOrganizationAction} className="mt-6 space-y-5">
          <div><label className="label" htmlFor="name">Organization name</label><input className="input" id="name" name="name" defaultValue={organization.name} maxLength={100} required /></div>
          <div><label className="label" htmlFor="slug">Organization slug</label><input className="input" id="slug" name="slug" defaultValue={organization.slug} maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /><p className="mt-1 text-xs text-surface-500">Lowercase letters, numbers and hyphens. Must be unique.</p></div>
          <div className="flex justify-end"><button className="btn-primary" type="submit">Save organization</button></div>
        </form>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Tenant boundary</h2>
        <p className="mt-2 text-sm leading-6 text-surface-600">Organization access is derived from your authenticated database-backed session. Organization IDs are not accepted from the browser as an authorization source.</p>
      </section>
    </div>
  );
}

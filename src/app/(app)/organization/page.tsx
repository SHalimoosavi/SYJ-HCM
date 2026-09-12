import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getOrganizationForAdmin, getOrganizationMembersForAdmin } from '@/lib/organization-management';
import { getOrganizationConfiguration } from '@/lib/platform';
import { updateOrganizationAction, updateOrganizationConfigurationAction, updatePublicCareersAction } from './actions';

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireRole('admin');
  const organization = await getOrganizationForAdmin(user);
  const members = await getOrganizationMembersForAdmin(user);
  const configuration = await getOrganizationConfiguration(user);
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
        <div className="border-b border-surface-200 pb-4"><h2 className="text-lg font-semibold">Organization configuration</h2><p className="text-sm text-surface-500">Tenant-owned defaults used by future HCM modules and shared presentation logic.</p></div>
        <form action={updateOrganizationConfigurationAction} className="mt-6 grid gap-5 sm:grid-cols-2">
          <div><label className="label" htmlFor="timezone">Timezone</label><select className="input" id="timezone" name="timezone" defaultValue={configuration?.timezone ?? 'UTC'}><option>UTC</option><option>Asia/Kolkata</option><option>Asia/Dubai</option><option>Asia/Singapore</option><option>Europe/London</option><option>Europe/Berlin</option><option>America/New_York</option><option>America/Los_Angeles</option><option>Australia/Sydney</option></select></div>
          <div><label className="label" htmlFor="locale">Locale</label><select className="input" id="locale" name="locale" defaultValue={configuration?.locale ?? 'en-IN'}><option value="en-IN">English (India)</option><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option></select></div>
          <div><label className="label" htmlFor="dateFormat">Date format</label><select className="input" id="dateFormat" name="dateFormat" defaultValue={configuration?.dateFormat ?? 'YYYY-MM-DD'}><option>YYYY-MM-DD</option><option>DD-MM-YYYY</option><option>MM-DD-YYYY</option></select></div>
          <div><label className="label" htmlFor="weekStartDay">Week starts</label><select className="input" id="weekStartDay" name="weekStartDay" defaultValue={String(configuration?.weekStartDay ?? 1)}><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select></div>
          <div className="sm:col-span-2 flex justify-end"><button className="btn-primary" type="submit">Save configuration</button></div>
        </form>
        <div className="mt-6 border-t border-surface-200 pt-6"><h3 className="font-semibold">Public careers</h3><p className="mt-1 text-sm text-surface-500">Allow published jobs from this tenant to appear on the public careers portal. Suspended organizations are always hidden.</p><form action={updatePublicCareersAction} className="mt-4 flex items-center justify-between gap-4"><label className="flex items-center gap-3 text-sm"><input type="checkbox" name="publicCareersEnabled" value="true" defaultChecked={configuration?.publicCareersEnabled ?? false}/> Enable public careers</label><button className="btn-secondary" type="submit">Save careers setting</button></form></div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Tenant boundary</h2>
        <p className="mt-2 text-sm leading-6 text-surface-600">Organization access is derived from your authenticated database-backed session. Organization IDs are not accepted from the browser as an authorization source.</p>
      </section>
    </div>
  );
}

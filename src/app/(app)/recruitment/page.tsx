import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listApplications, listCandidates, listJobs } from '@/lib/recruitment';

export default async function RecruitmentPage() {
  const user = await requireRole('admin','hr');
  const [jobs, candidates, apps] = await Promise.all([listJobs(user.organizationId), listCandidates(user.organizationId), listApplications(user.organizationId)]);
  const open = jobs.filter(j=>j.status==='open').length;
  const statusCounts = new Map<string, number>(); apps.forEach(a=>statusCounts.set(a.status,(statusCounts.get(a.status)||0)+1));
  return <div className="max-w-6xl space-y-6">
    <div><p className="text-sm font-medium text-brand-600">Recruitment / ATS</p><h1 className="mt-1 text-2xl font-semibold">Recruitment overview</h1><p className="mt-1 text-sm text-surface-500">A tenant-scoped foundation for jobs, candidates and applications.</p></div>
    <div className="grid gap-4 sm:grid-cols-4">
      {[['Open jobs',open],['All jobs',jobs.length],['Candidates',candidates.length],['Applications',apps.length]].map(([label,value])=><div className="card p-5" key={String(label)}><p className="text-xs font-medium uppercase tracking-wide text-surface-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Application pipeline</h2><p className="text-sm text-surface-500">Current status counts from your organization.</p></div><Link className="btn-secondary" href="/recruitment/applications">View all</Link></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{['applied','screening','shortlisted','interview','evaluation','offer','hired','rejected','withdrawn'].map(s=><div className="rounded-lg border border-surface-200 p-3" key={s}><p className="text-xs text-surface-500 capitalize">{s}</p><p className="mt-1 text-xl font-semibold">{statusCounts.get(s)||0}</p></div>)}</div></section>
      <section className="card p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Quick actions</h2><p className="text-sm text-surface-500">Use real tenant data; no sample records are generated.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Link className="btn-primary" href="/recruitment/jobs/new">Create job</Link><Link className="btn-secondary" href="/recruitment/candidates/new">Add candidate</Link><Link className="btn-secondary" href="/recruitment/applications/new">Create application</Link><Link className="btn-secondary" href="/recruitment/jobs">Manage jobs</Link></div></section>
    </div>
  </div>;
}

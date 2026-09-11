import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listRecruitmentPeople } from '@/lib/recruitment';
import { JobForm } from '../../forms';
export default async function NewJobPage(){const u=await requireRole('admin','hr');const p=await listRecruitmentPeople(u.organizationId);return <div className="max-w-4xl space-y-6"><div><Link className="text-sm text-brand-600 hover:underline" href="/recruitment/jobs">← Jobs</Link><h1 className="mt-2 text-2xl font-semibold">Create job requisition</h1><p className="mt-1 text-sm text-surface-500">Create a real tenant-scoped opening with controlled lifecycle.</p></div><section className="card p-6"><JobForm departments={p.departments} employees={p.employees} users={p.users}/></section></div>}

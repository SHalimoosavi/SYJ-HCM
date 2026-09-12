import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { listRecruitmentStages } from '@/lib/recruitment-workflow';
import { StageSettings } from '../workflow-forms';
export default async function StagesPage(){const u=await requireRole('admin','hr');const stages=await listRecruitmentStages(u.organizationId);return <div className="max-w-5xl space-y-6"><div><Link className="text-sm text-brand-600 hover:underline" href="/recruitment">← Recruitment</Link><h1 className="mt-2 text-2xl font-semibold">Workflow stages</h1><p className="mt-1 text-sm text-surface-500">Customize stage names, order and active visibility. Lifecycle transitions remain server-controlled.</p></div><section className="card p-6"><StageSettings stages={stages}/></section></div>}

import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getPublicationForInternal } from '@/lib/public-recruitment';
import { PublicationForm } from '@/app/(app)/recruitment/publishing-form';
import { publishJobAction, changePublicationStatusAction } from '@/app/(app)/recruitment/publishing-actions';

export default async function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole('admin','hr');
  const { id } = await params;
  const row = (await getPublicationForInternal(user.organizationId,id))[0];
  if (!row) return <div className="card p-6">Job requisition not found.</div>;
  const p = row.publication;
  return <div className="max-w-5xl space-y-6">
    <div><Link href={`/recruitment/jobs/${id}`} className="text-sm text-brand-600 hover:underline">← Job requisition</Link><div className="mt-2"><p className="text-sm font-medium text-brand-600">Public careers</p><h1 className="text-2xl font-semibold">{p.publicTitle}</h1><p className="mt-1 text-sm text-surface-500">Controlled public representation of {row.jobTitle}.</p></div></div>
    <section className="card p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Publication state</h2><p className="mt-1 text-sm text-surface-500">Organization careers: <strong>{row.careersEnabled ? 'enabled' : 'disabled'}</strong></p></div><span className={p.status==='published'?'badge-green':p.status==='closed'||p.status==='archived'?'badge-gray':'badge-amber'}>{p.status}</span></div>
      <div className="mt-4 flex flex-wrap gap-2">
        {p.status==='draft' && <form action={async () => { await publishJobAction(id); }}><button className="btn-primary">Publish job</button></form>}
        {p.status==='published' && <><form action={async () => { await changePublicationStatusAction(id,'draft'); }}><button className="btn-secondary">Unpublish</button></form><form action={async () => { await changePublicationStatusAction(id,'closed'); }}><button className="btn-secondary">Close applications</button></form></>}
        {p.status!=='archived' && <form action={async () => { await changePublicationStatusAction(id,'archived'); }}><button className="btn-danger">Archive publication</button></form>}
      </div>
    </section>
    <section className="card p-6"><h2 className="text-lg font-semibold">Public content</h2><p className="mt-1 text-sm text-surface-500">Only these deliberately selected fields are exposed to the careers portal.</p><div className="mt-5"><PublicationForm jobId={id} initial={p} /></div></section>
    <section className="card p-6"><h2 className="text-lg font-semibold">Public preview</h2><p className="mt-1 text-sm text-surface-500">{p.status==='published' ? 'The public page is available at the job slug.' : 'Publish the job to expose it publicly.'}</p>{p.status==='published' && <Link className="btn-secondary mt-4 inline-flex" href={`/careers/${p.publicSlug}`} target="_blank">Open public job ↗</Link>}</section>
  </div>;
}

'use client';
import { useFormState, useFormStatus } from 'react-dom';
import { savePublicationAction, type PublicationFormState } from './publishing-actions';
const initial: PublicationFormState={error:null};
function Submit(){const {pending}=useFormStatus();return <button className="btn-primary" disabled={pending}>{pending?'Saving…':'Save public content'}</button>}
type PublicationFormInitial = {
  publicTitle: string;
  publicSlug: string;
  publicLocation: string | null;
  publicDepartmentName: string | null;
  employmentType: string;
  workplaceType: string;
  closesAt: string | null;
  applicationEnabled: boolean;
  publicDescription: string;
};

export function PublicationForm({jobId,initial: p}:{jobId:string;initial:PublicationFormInitial}){const [state,action]=useFormState(savePublicationAction.bind(null,jobId),initial);return <form action={action} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><label className="label">Public title *</label><input className="input" name="publicTitle" maxLength={200} required defaultValue={p.publicTitle}/></div><div className="sm:col-span-2"><label className="label">Public URL slug *</label><input className="input" name="publicSlug" maxLength={140} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" defaultValue={p.publicSlug}/><p className="mt-1 text-xs text-surface-500">/careers/{p.publicSlug}</p></div><div><label className="label">Location</label><input className="input" name="publicLocation" maxLength={200} defaultValue={p.publicLocation??''}/></div><div><label className="label">Department/category</label><input className="input" name="publicDepartmentName" maxLength={120} defaultValue={p.publicDepartmentName??''}/></div><div><label className="label">Employment type *</label><select className="input" name="employmentType" defaultValue={p.employmentType}><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="temporary">Temporary</option><option value="internship">Internship</option></select></div><div><label className="label">Workplace type *</label><select className="input" name="workplaceType" defaultValue={p.workplaceType}><option value="on_site">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option></select></div><div><label className="label">Closing date/time</label><input className="input" type="datetime-local" name="closesAt" defaultValue={p.closesAt?new Date(p.closesAt).toISOString().slice(0,16):''}/></div><div className="flex items-end pb-2"><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="applicationEnabled" defaultChecked={p.applicationEnabled}/> Accept applications</label></div><div className="sm:col-span-2"><label className="label">Public description *</label><textarea className="input" name="publicDescription" rows={12} maxLength={50000} required defaultValue={p.publicDescription}/></div></div>{state.error&&<p className="text-sm text-red-600" role="alert">{state.error}</p>}<Submit/></form>}

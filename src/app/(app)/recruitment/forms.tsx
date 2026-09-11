'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createApplicationAction, createCandidateAction, createJobAction, updateCandidateAction, updateJobAction, type FormState } from './actions';

const initial: FormState = { error: null };
function Submit({ children }: { children: string }) { const { pending } = useFormStatus(); return <button className="btn-primary" disabled={pending}>{pending ? 'Saving…' : children}</button>; }

export function JobForm({ departments, employees, users, initialValues, jobId }: { departments: {id:string;name:string}[]; employees:{id:string;firstName:string;lastName:string;designation:string}[]; users:{id:string;email:string;role:string}[]; initialValues?: any; jobId?: string }) {
  const action = jobId ? updateJobAction.bind(null, jobId) : createJobAction;
  const [state, formAction] = useFormState(action, initial);
  return <form action={formAction} className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      {!jobId && <div><label className="label">Requisition code *</label><input className="input" name="requisitionCode" required pattern="[A-Z0-9][A-Z0-9-]{2,31}" defaultValue={initialValues?.requisitionCode}/></div>}
      <div className={jobId ? 'sm:col-span-2' : ''}><label className="label">Job title *</label><input className="input" name="title" required maxLength={200} defaultValue={initialValues?.title}/></div>
      <div><label className="label">Department</label><select className="input" name="departmentId" defaultValue={initialValues?.departmentId ?? ''}><option value="">— None —</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
      <div><label className="label">Location</label><input className="input" name="location" defaultValue={initialValues?.location ?? ''} placeholder="Hyderabad, India"/></div>
      <div><label className="label">Employment type *</label><select className="input" name="employmentType" defaultValue={initialValues?.employmentType ?? 'full_time'}>{[['full_time','Full time'],['part_time','Part time'],['contract','Contract'],['temporary','Temporary'],['internship','Internship']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
      <div><label className="label">Openings *</label><input className="input" type="number" min="1" max="100000" name="openings" defaultValue={initialValues?.openings ?? 1} required/></div>
      <div><label className="label">Hiring manager</label><select className="input" name="hiringManagerEmployeeId" defaultValue={initialValues?.hiringManagerEmployeeId ?? ''}><option value="">— Unassigned —</option>{employees.map(e=><option key={e.id} value={e.id}>{e.firstName} {e.lastName} — {e.designation}</option>)}</select></div>
      <div><label className="label">Recruiter</label><select className="input" name="recruiterUserId" defaultValue={initialValues?.recruiterUserId ?? ''}><option value="">— Unassigned —</option>{users.filter(u=>u.role !== 'employee').map(u=><option key={u.id} value={u.id}>{u.email} ({u.role})</option>)}</select></div>
      <div><label className="label">Opening date</label><input className="input" type="date" name="openingDate" defaultValue={initialValues?.openingDate ?? ''}/></div>
      <div><label className="label">Closing date</label><input className="input" type="date" name="closingDate" defaultValue={initialValues?.closingDate ?? ''}/></div>
      <div><label className="label">Minimum salary</label><input className="input" type="number" min="0" step="0.01" name="salaryMin" defaultValue={initialValues?.salaryMin ?? ''}/></div>
      <div><label className="label">Maximum salary</label><input className="input" type="number" min="0" step="0.01" name="salaryMax" defaultValue={initialValues?.salaryMax ?? ''}/></div>
      <div><label className="label">Currency</label><input className="input" name="currency" maxLength={3} defaultValue={initialValues?.currency ?? 'INR'}/></div>
      <div><label className="label">Skills</label><input className="input" name="skills" defaultValue={initialValues?.skills ?? ''} placeholder="TypeScript, SQL, React"/></div>
      <div className="sm:col-span-2"><label className="label">Description *</label><textarea className="input" name="description" rows={5} required defaultValue={initialValues?.description ?? ''}/></div>
      <div className="sm:col-span-2"><label className="label">Requirements *</label><textarea className="input" name="requirements" rows={5} required defaultValue={initialValues?.requirements ?? ''}/></div>
    </div>
    {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
    <Submit>{jobId ? 'Save job' : 'Create job'}</Submit>
  </form>;
}

export function CandidateForm({ initialValues, candidateId }: { initialValues?: any; candidateId?: string }) {
  const action = candidateId ? updateCandidateAction.bind(null, candidateId) : createCandidateAction;
  const [state, formAction] = useFormState(action, initial);
  return <form action={formAction} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2">
    <div><label className="label">First name *</label><input className="input" name="firstName" required maxLength={100} defaultValue={initialValues?.firstName}/></div>
    <div><label className="label">Last name *</label><input className="input" name="lastName" required maxLength={100} defaultValue={initialValues?.lastName}/></div>
    <div><label className="label">Email *</label><input className="input" type="email" name="email" required maxLength={254} defaultValue={initialValues?.email}/></div>
    <div><label className="label">Phone</label><input className="input" name="phone" defaultValue={initialValues?.phone ?? ''}/></div>
    <div><label className="label">Location</label><input className="input" name="location" defaultValue={initialValues?.location ?? ''}/></div>
    <div><label className="label">Source</label><input className="input" name="source" defaultValue={initialValues?.source ?? ''} placeholder="Referral, career site, agency…"/></div>
    <div className="sm:col-span-2"><label className="label">Headline</label><input className="input" name="headline" maxLength={200} defaultValue={initialValues?.headline ?? ''}/></div>
    <div className="sm:col-span-2"><label className="label">Summary</label><textarea className="input" name="summary" rows={5} defaultValue={initialValues?.summary ?? ''}/></div>
  </div>{state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}<Submit>{candidateId ? 'Save candidate' : 'Create candidate'}</Submit></form>;
}

export function ApplicationForm({ candidates, jobs }: { candidates:{id:string;firstName:string;lastName:string;email:string}[]; jobs:{id:string;requisitionCode:string;title:string}[] }) {
  const [state, formAction] = useFormState(createApplicationAction, initial);
  return <form action={formAction} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2">
    <div><label className="label">Candidate *</label><select className="input" name="candidateId" required defaultValue=""><option value="" disabled>Select candidate</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.firstName} {c.lastName} — {c.email}</option>)}</select></div>
    <div><label className="label">Open job *</label><select className="input" name="requisitionId" required defaultValue=""><option value="" disabled>Select job</option>{jobs.map(j=><option key={j.id} value={j.id}>{j.requisitionCode} — {j.title}</option>)}</select></div>
    <div><label className="label">Source</label><input className="input" name="source" placeholder="Career site, referral…"/></div>
    <div className="sm:col-span-2"><label className="label">Notes</label><textarea className="input" name="notes" rows={3}/></div>
  </div>{state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}<Submit>Create application</Submit></form>;
}

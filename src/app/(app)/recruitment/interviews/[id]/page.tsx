import Link from 'next/link';
import { requireUser, isHrOrAdmin } from '@/lib/auth';
import { canViewInterview, getInterview, getInterviewFormData, INTERVIEW_STATUSES } from '@/lib/recruitment-workflow';
import { ParticipantForm, FeedbackForm, FeedbackCorrectionForm, DecisionForm, RescheduleForm } from '../../workflow-forms';
import { interviewStatusAction, removeParticipantAction } from '../../workflow-actions';

function localValue(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const transitions: Record<string, string[]> = {
  scheduled: ['confirmed', 'cancelled', 'rescheduled'],
  confirmed: ['completed', 'cancelled', 'rescheduled', 'no_show'],
  rescheduled: ['confirmed', 'cancelled', 'completed', 'no_show']
};

export default async function InterviewDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const data = getInterview(u.organizationId, id);
  if (!data || !canViewInterview(u.organizationId, u.id, u.role, id)) return <div className="card p-8">Interview not found.</div>;
  const p = await searchParams;
  const manager = isHrOrAdmin(u.role);
  const visibleFeedback = manager ? data.feedback : data.feedback.filter((f: any) => f.interviewer_user_id === u.id);
  const ownAssigned = data.participants.some((x: any) => x.user_id === u.id && x.role === 'interviewer');
  const people = manager ? getInterviewFormData(u.organizationId).people : [];
  const next = (transitions[data.interview.status] || []).filter((s) => INTERVIEW_STATUSES.includes(s as any));

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link className="text-sm text-brand-600 hover:underline" href="/recruitment/interviews">← Interviews</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand-600">{data.interview.application_reference}</p>
            <h1 className="text-2xl font-semibold">{data.interview.title}</h1>
            <p className="mt-1 text-sm text-surface-500">{data.interview.first_name} {data.interview.last_name} · {data.interview.requisition_code} — {data.interview.job_title}</p>
          </div>
          <span className={data.interview.status === 'completed' ? 'badge-green' : data.interview.status === 'cancelled' || data.interview.status === 'no_show' ? 'badge-gray' : 'badge-amber'}>
            {data.interview.status.replaceAll('_', ' ')}
          </span>
        </div>
      </div>

      {p.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{p.error}</div>}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Schedule</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs text-surface-500">Start</p><p className="mt-1 font-medium">{new Date(data.interview.scheduled_start).toLocaleString('en-IN', { timeZone: data.interview.timezone })}</p></div>
          <div><p className="text-xs text-surface-500">End</p><p className="mt-1 font-medium">{new Date(data.interview.scheduled_end).toLocaleString('en-IN', { timeZone: data.interview.timezone })}</p></div>
          <div><p className="text-xs text-surface-500">Timezone</p><p className="mt-1 font-medium">{data.interview.timezone}</p></div>
          <div><p className="text-xs text-surface-500">Type</p><p className="mt-1 font-medium">{data.interview.interview_type.replaceAll('_', ' ')}</p></div>
          <div><p className="text-xs text-surface-500">Location</p><p className="mt-1 font-medium">{data.interview.location || '—'}</p></div>
          <div><p className="text-xs text-surface-500">Meeting details</p><p className="mt-1 font-medium break-words">{data.interview.meeting_details || '—'}</p></div>
        </div>
        {manager && next.length > 0 && <div className="mt-5 flex flex-wrap gap-2">{next.map((status) => <form key={status} action={interviewStatusAction}><input type="hidden" name="interviewId" value={id}/><input type="hidden" name="status" value={status}/><button className={status === 'cancelled' ? 'btn-danger' : 'btn-secondary'}>{status.replaceAll('_', ' ')}</button></form>)}</div>}
      </section>

      {manager && ['scheduled', 'confirmed', 'rescheduled'].includes(data.interview.status) && (
        <RescheduleForm interviewId={id} timezone={data.interview.timezone} startLocal={localValue(data.interview.scheduled_start, data.interview.timezone)} endLocal={localValue(data.interview.scheduled_end, data.interview.timezone)} />
      )}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Interview panel</h2>
        <div className="mt-4 space-y-3">
          {data.participants.map((x: any) => (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-surface-200 p-3" key={x.user_id}>
              <div><p className="font-medium">{x.first_name || 'User'} {x.last_name || ''}</p><p className="text-xs text-surface-500">{x.email} · {x.role}</p></div>
              {manager && <form action={removeParticipantAction}><input type="hidden" name="interviewId" value={id}/><input type="hidden" name="userId" value={x.user_id}/><button className="btn-secondary">Remove</button></form>}
            </div>
          ))}
        </div>
        {manager && <div className="mt-5 border-t border-surface-200 pt-5"><ParticipantForm interviewId={id} people={people}/></div>}
      </section>

      {ownAssigned && data.interview.status === 'completed' && visibleFeedback.filter((f: any) => f.interviewer_user_id === u.id).length === 0 && (
        <section className="card p-6"><h2 className="text-lg font-semibold">Submit your feedback</h2><p className="mt-1 text-sm text-surface-500">Your feedback is immutable after submission; corrections are recorded separately.</p><div className="mt-5"><FeedbackForm interviewId={id}/></div></section>
      )}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Interview feedback</h2>
        {visibleFeedback.length === 0 ? <p className="mt-4 text-sm text-surface-500">No feedback is available to you.</p> : (
          <div className="mt-4 space-y-5">
            {visibleFeedback.map((f: any) => {
              const corrections = data.corrections.filter((c: any) => c.feedback_id === f.id);
              return <article className="rounded-lg border border-surface-200 p-4" key={f.id}>
                <div className="flex flex-wrap justify-between gap-3"><div><p className="font-medium">{f.email}</p><p className="text-xs text-surface-500">Score {f.score}/5 · {f.recommendation.replaceAll('_', ' ')}</p></div><time className="text-xs text-surface-500">{f.submitted_at}</time></div>
                <div className="mt-4 grid gap-4 sm:grid-cols-3 text-sm"><div><p className="font-medium">Strengths</p><p className="mt-1 whitespace-pre-wrap text-surface-600">{f.strengths}</p></div><div><p className="font-medium">Concerns</p><p className="mt-1 whitespace-pre-wrap text-surface-600">{f.concerns}</p></div><div><p className="font-medium">Notes</p><p className="mt-1 whitespace-pre-wrap text-surface-600">{f.notes || '—'}</p></div></div>
                {manager && <>
                  <FeedbackCorrectionForm feedback={f} interviewId={id}/>
                  {corrections.length > 0 && <div className="mt-4 border-t border-surface-200 pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-surface-500">Correction history</p><ul className="mt-2 space-y-2">{corrections.map((c: any) => <li className="text-xs text-surface-600" key={c.id}>{c.previous_score}/5 → {c.new_score}/5 · {c.reason} · {c.created_at}</li>)}</ul></div>}
                </>}
              </article>;
            })}
          </div>
        )}
      </section>

      {manager && <section className="card p-6"><h2 className="text-lg font-semibold">Decision</h2>{data.decision ? <div className="mt-4 rounded-lg border border-surface-200 p-4"><p className="font-medium">{data.decision.outcome.replaceAll('_', ' ')}</p><p className="mt-1 whitespace-pre-wrap text-sm text-surface-600">{data.decision.rationale}</p><p className="mt-2 text-xs text-surface-500">Recorded by {data.decision.decided_by_email} · {data.decision.created_at}</p></div> : data.interview.status === 'completed' ? <div className="mt-4"><DecisionForm interviewId={id}/></div> : <p className="mt-4 text-sm text-surface-500">Decision becomes available after completion.</p>}</section>}
    </div>
  );
}

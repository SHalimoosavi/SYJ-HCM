import Link from 'next/link';
import { requireUser, isHrOrAdmin } from '@/lib/auth';
import { canViewInterview, getInterview, getInterviewFormData, INTERVIEW_STATUSES } from '@/lib/recruitment-workflow';
import { ParticipantForm, FeedbackForm, FeedbackCorrectionForm, DecisionForm, RescheduleForm } from '../../workflow-forms';
import { interviewStatusAction, removeParticipantAction } from '../../workflow-actions';

function localValue(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const transitions: Record<string, string[]> = {
  scheduled: ['confirmed', 'cancelled', 'rescheduled'],
  confirmed: ['completed', 'cancelled', 'rescheduled', 'no_show'],
  rescheduled: ['confirmed', 'cancelled', 'completed', 'no_show'],
};

export default async function InterviewDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const u = await requireUser();
  const { id } = await params;
  const raw = await getInterview(u.organizationId, id);

  if (!raw || !(await canViewInterview(u.organizationId, u.id, u.role, id))) {
    return <div className="card p-8">Interview not found.</div>;
  }

  const p = await searchParams;
  const manager = isHrOrAdmin(u.role);
  const interview = raw.interview.interview;
  const visibleFeedback = manager
    ? raw.feedback
    : raw.feedback.filter((f) => f.feedback.interviewerUserId === u.id);
  const ownAssigned = raw.participants.some((x) => x.userId === u.id && x.role === 'interviewer');
  const people = manager ? (await getInterviewFormData(u.organizationId)).people : [];
  const next = (transitions[interview.status] ?? []).filter((s) =>
    INTERVIEW_STATUSES.includes(s as (typeof INTERVIEW_STATUSES)[number]),
  );

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <Link className="text-sm text-brand-600 hover:underline" href="/recruitment/interviews">← Interviews</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand-600">{raw.interview.applicationReference}</p>
            <h1 className="text-2xl font-semibold">{interview.title}</h1>
            <p className="mt-1 text-sm text-surface-500">
              {raw.interview.firstName} {raw.interview.lastName} · {raw.interview.requisitionCode} — {raw.interview.jobTitle}
            </p>
          </div>
          <span className={interview.status === 'completed' ? 'badge-green' : interview.status === 'cancelled' || interview.status === 'no_show' ? 'badge-gray' : 'badge-amber'}>
            {interview.status.replaceAll('_', ' ')}
          </span>
        </div>
      </div>

      {p.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{p.error}</div>}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Schedule</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs text-surface-500">Start</p><p className="mt-1 font-medium">{new Date(interview.scheduledStart).toLocaleString('en-IN', { timeZone: interview.timezone })}</p></div>
          <div><p className="text-xs text-surface-500">End</p><p className="mt-1 font-medium">{new Date(interview.scheduledEnd).toLocaleString('en-IN', { timeZone: interview.timezone })}</p></div>
          <div><p className="text-xs text-surface-500">Timezone</p><p className="mt-1 font-medium">{interview.timezone}</p></div>
          <div><p className="text-xs text-surface-500">Type</p><p className="mt-1 font-medium">{interview.interviewType.replaceAll('_', ' ')}</p></div>
          <div><p className="text-xs text-surface-500">Location</p><p className="mt-1 font-medium">{interview.location || '—'}</p></div>
          <div><p className="text-xs text-surface-500">Meeting details</p><p className="mt-1 font-medium break-words">{interview.meetingDetails || '—'}</p></div>
        </div>
        {manager && next.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {next.map((status) => <form key={status} action={interviewStatusAction}>
              <input type="hidden" name="interviewId" value={id} />
              <input type="hidden" name="status" value={status} />
              <button className={status === 'cancelled' ? 'btn-danger' : 'btn-secondary'}>{status.replaceAll('_', ' ')}</button>
            </form>)}
          </div>
        )}
      </section>

      {manager && ['scheduled', 'confirmed', 'rescheduled'].includes(interview.status) && (
        <RescheduleForm interviewId={id} timezone={interview.timezone} startLocal={localValue(interview.scheduledStart, interview.timezone)} endLocal={localValue(interview.scheduledEnd, interview.timezone)} />
      )}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Interview panel</h2>
        <div className="mt-4 space-y-3">
          {raw.participants.map((x) => <div className="flex items-center justify-between gap-4 rounded-lg border border-surface-200 p-3" key={x.userId}>
            <div><p className="font-medium">{x.firstName || 'User'} {x.lastName || ''}</p><p className="text-xs text-surface-500">{x.email} · {x.role}</p></div>
            {manager && <form action={removeParticipantAction}><input type="hidden" name="interviewId" value={id} /><input type="hidden" name="userId" value={x.userId} /><button className="btn-secondary">Remove</button></form>}
          </div>)}
        </div>
        {manager && <div className="mt-5 border-t border-surface-200 pt-5"><ParticipantForm interviewId={id} people={people} /></div>}
      </section>

      {ownAssigned && interview.status === 'completed' && visibleFeedback.filter((f) => f.feedback.interviewerUserId === u.id).length === 0 && (
        <section className="card p-6"><h2 className="text-lg font-semibold">Submit your feedback</h2><p className="mt-1 text-sm text-surface-500">Your feedback is immutable after submission; corrections are recorded separately.</p><div className="mt-5"><FeedbackForm interviewId={id} /></div></section>
      )}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Interview feedback</h2>
        {visibleFeedback.length === 0 ? <p className="mt-4 text-sm text-surface-500">No feedback is available to you.</p> : <div className="mt-4 space-y-5">
          {visibleFeedback.map((f) => {
            const corrections = raw.corrections.filter((c) => c.feedbackId === f.feedback.id);
            const latestCorrection = corrections.at(-1);
            const feedback = latestCorrection
              ? { ...f.feedback, score: latestCorrection.newScore, recommendation: latestCorrection.newRecommendation, strengths: latestCorrection.newStrengths, concerns: latestCorrection.newConcerns, notes: latestCorrection.newNotes }
              : f.feedback;
            return <article className="rounded-lg border border-surface-200 p-4" key={feedback.id}>
              <div className="flex flex-wrap justify-between gap-3"><div><p className="font-medium">{f.email}</p><p className="text-xs text-surface-500">Score {feedback.score}/5 · {feedback.recommendation.replaceAll('_', ' ')}</p></div><time className="text-xs text-surface-500">{feedback.submittedAt}</time></div>
              <div className="mt-4 grid gap-4 sm:grid-cols-3 text-sm"><div><p className="font-medium">Strengths</p><p className="mt-1 whitespace-pre-wrap text-surface-600">{feedback.strengths}</p></div><div><p className="font-medium">Concerns</p><p className="mt-1 whitespace-pre-wrap text-surface-600">{feedback.concerns}</p></div><div><p className="font-medium">Notes</p><p className="mt-1 whitespace-pre-wrap text-surface-600">{feedback.notes || '—'}</p></div></div>
              {manager && <><FeedbackCorrectionForm feedback={feedback} interviewId={id} />{corrections.length > 0 && <div className="mt-4 border-t border-surface-200 pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-surface-500">Correction history</p><ul className="mt-2 space-y-2">{corrections.map((c) => <li className="text-xs text-surface-600" key={c.id}>{c.previousScore}/5 → {c.newScore}/5 · {c.reason} · {c.createdAt}</li>)}</ul></div>}</>}
            </article>;
          })}
        </div>}
      </section>

      {manager && <section className="card p-6"><h2 className="text-lg font-semibold">Decision</h2>{raw.decision ? <div className="mt-4 rounded-lg border border-surface-200 p-4"><p className="font-medium">{raw.decision.decision.outcome.replaceAll('_', ' ')}</p><p className="mt-1 whitespace-pre-wrap text-sm text-surface-600">{raw.decision.decision.rationale}</p><p className="mt-2 text-xs text-surface-500">Recorded by {raw.decision.decidedByEmail} · {raw.decision.decision.createdAt}</p></div> : interview.status === 'completed' ? <div className="mt-4"><DecisionForm interviewId={id} /></div> : <p className="mt-4 text-sm text-surface-500">Decision becomes available after completion.</p>}</section>}
    </div>
  );
}

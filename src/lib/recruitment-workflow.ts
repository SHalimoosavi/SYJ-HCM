import { db, sqlite, withSqliteTransactionSync } from '@/db/client';
import { recordAuditSync } from '@/lib/audit';
import { asc, and, desc, eq } from 'drizzle-orm';
import { applications, candidates, users, recruitmentStages, interviews } from '@/db/schema';
import { nanoid } from 'nanoid';

export {
  WORKFLOW_STATUSES,
  INTERVIEW_STATUSES,
  FEEDBACK_RECOMMENDATIONS,
  DECISION_OUTCOMES,
  INTERVIEW_TYPES,
  ACTIVITY_TYPES,
} from '@/lib/recruitment-constants';

export type {
  WorkflowStatus,
  InterviewStatus,
  FeedbackRecommendation,
  DecisionOutcome,
} from '@/lib/recruitment-constants';

import {
  WORKFLOW_STATUSES,
  INTERVIEW_STATUSES,
  INTERVIEW_TYPES,
  FEEDBACK_RECOMMENDATIONS,
  DECISION_OUTCOMES,
} from '@/lib/recruitment-constants';

import type {
  WorkflowStatus,
  InterviewStatus,
  FeedbackRecommendation,
  DecisionOutcome,
} from '@/lib/recruitment-constants';

const workflowTransitions: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  applied: ['screening','rejected','withdrawn'], screening: ['shortlisted','interview','rejected','withdrawn'],
  shortlisted: ['interview','rejected','withdrawn'], interview: ['evaluation','rejected','withdrawn'],
  evaluation: ['offer','rejected','withdrawn'], offer: ['hired','rejected','withdrawn'], hired: [],
  rejected: ['archived'], withdrawn: ['archived'], archived: []
};
const interviewTransitions: Record<InterviewStatus, readonly InterviewStatus[]> = {
  scheduled: ['confirmed','cancelled','rescheduled'], confirmed: ['completed','cancelled','rescheduled','no_show'],
  rescheduled: ['confirmed','cancelled','completed','no_show'], completed: [], cancelled: [], no_show: []
};
const DEFAULT_STAGES: Array<[WorkflowStatus,string,number]> = [
  ['applied','Applied',0],['screening','Screening',1],['shortlisted','Shortlisted',2],['interview','Interview',3],
  ['evaluation','Evaluation',4],['offer','Offer',5],['hired','Hired',6],['rejected','Rejected',7],['withdrawn','Withdrawn',8],['archived','Archived',9]
];

export function canTransitionWorkflow(from: WorkflowStatus, to: WorkflowStatus) { return workflowTransitions[from]?.includes(to) ?? false; }
export function canTransitionInterview(from: InterviewStatus, to: InterviewStatus) { return interviewTransitions[from]?.includes(to) ?? false; }
export function stageLabel(status: string) { return status.replaceAll('_',' ').replace(/\b\w/g, (m) => m.toUpperCase()); }

function assertOrganizationActive(organizationId:string):void { const r=sqlite.prepare('SELECT status FROM organizations WHERE id=?').get(organizationId) as {status?:string}|undefined; if(r?.status!=='active') throw new Error('Your organization is currently suspended.'); }

function assertText(value: string, label: string, max: number): string { const v=value.trim(); if(!v || v.length>max) throw new Error(`${label} is required and must be at most ${max} characters.`); return v; }
function assertOptionalText(value: string | null | undefined, label: string, max: number): string | null { const v=(value ?? '').trim(); if(v.length>max) throw new Error(`${label} must be at most ${max} characters.`); return v || null; }
function assertStatus(value: string): WorkflowStatus { if(!WORKFLOW_STATUSES.includes(value as WorkflowStatus)) throw new Error('Invalid workflow status.'); return value as WorkflowStatus; }
function assertInterviewStatus(value: string): InterviewStatus { if(!INTERVIEW_STATUSES.includes(value as InterviewStatus)) throw new Error('Invalid interview status.'); return value as InterviewStatus; }
function assertTimezone(value: string): string { const tz=value.trim(); if(!tz || tz.length>80) throw new Error('A valid timezone is required.'); try { new Intl.DateTimeFormat('en-US',{timeZone:tz}).format(new Date()); } catch { throw new Error('Unsupported timezone.'); } return tz; }
function assertLocalDateTime(value: string): string { if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Use a valid date and time.'); const d=new Date(`${value}:00Z`); if(Number.isNaN(d.getTime())) throw new Error('Invalid date and time.'); return value; }

/** Convert a wall-clock local datetime in an IANA timezone to a canonical UTC ISO timestamp. */
export function localDateTimeToUtc(value: string, timezone: string): string {
  const local=assertLocalDateTime(value); const tz=assertTimezone(timezone);
  const [date,time]=local.split('T');
  if (!date || !time) throw new Error('Use a valid date and time.');
  const dateParts=date.split('-').map(Number);
  const timeParts=time.split(':').map(Number);
  const [y,m,d]=dateParts;
  const [hh,mm]=timeParts;
  if (
    y === undefined || m === undefined || d === undefined ||
    hh === undefined || mm === undefined ||
    [y,m,d,hh,mm].some((n) => !Number.isFinite(n))
  ) {
    throw new Error('Invalid date and time.');
  }
  let guess=Date.UTC(y,m-1,d,hh,mm,0,0);
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++) {
    const parts=Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const asUtc=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
    const desired=Date.UTC(y,m-1,d,hh,mm,0,0); guess += desired-asUtc;
  }
  const result=new Date(guess); const parts=Object.fromEntries(fmt.formatToParts(result).filter(p=>p.type!=='literal').map(p=>[p.type,p.value])); const round=`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  if(round !== local) throw new Error('That local time does not exist in the selected timezone. Choose another time.');
  return result.toISOString();
}

export function validateSchedule(startLocal:string,endLocal:string,timezone:string) {
  const start=localDateTimeToUtc(startLocal,timezone); const end=localDateTimeToUtc(endLocal,timezone);
  if(new Date(end).getTime()<=new Date(start).getTime()) throw new Error('Interview end time must be after the start time.');
  return {start,end,timezone};
}

export function provisionDefaultRecruitmentStagesSync(organizationId:string, actorUserId:string): void {
  for(const [key,name,position] of DEFAULT_STAGES) sqlite.prepare(`INSERT OR IGNORE INTO recruitment_stages (id,organization_id,status_key,name,position,is_active,created_by,updated_by) VALUES (?,?,?,?,?,1,?,?)`).run(`${organizationId}:${key}`,organizationId,key,name,position,actorUserId,actorUserId);
}

export async function listRecruitmentStages(organizationId:string) { return db.select().from(recruitmentStages).where(eq(recruitmentStages.organizationId,organizationId)).orderBy(asc(recruitmentStages.position),asc(recruitmentStages.id)); }

export function updateRecruitmentStageInTransaction(organizationId:string,actorUserId:string,id:string,name:string,position:number,isActive:boolean):void { assertOrganizationActive(organizationId);
  const n=assertText(name,'Stage name',100); if(!Number.isInteger(position)||position<0||position>99) throw new Error('Stage position must be a whole number from 0 to 99.');
  withSqliteTransactionSync(()=>{
    const row=sqlite.prepare('SELECT status_key FROM recruitment_stages WHERE organization_id=? AND id=?').get(organizationId,id) as {status_key?:string}|undefined;
    if(!row?.status_key) throw new Error('Workflow stage not found.');
    if(!isActive){ const inUse=sqlite.prepare('SELECT id FROM applications WHERE organization_id=? AND current_stage=? LIMIT 1').get(organizationId,row.status_key) as {id?:string}|undefined; if(inUse?.id) throw new Error('A stage used by an application cannot be deactivated.'); }
    const collision=sqlite.prepare('SELECT id FROM recruitment_stages WHERE organization_id=? AND position=? AND id<>?').get(organizationId,position,id) as {id?:string}|undefined;
    if(collision?.id) throw new Error('Another workflow stage already uses that position.');
    sqlite.prepare('UPDATE recruitment_stages SET name=?,position=?,is_active=?,updated_by=?,updated_at=current_timestamp WHERE organization_id=? AND id=?').run(n,position,isActive?1:0,actorUserId,organizationId,id);
    recordAuditSync({organizationId,actorUserId,action:'recruitment_stage_updated',entityType:'recruitment_stage',entityId:id,metadata:{name:n,position,isActive}});
  });
}

function activity(organizationId:string,candidateId:string,applicationId:string|null,interviewId:string|null,type:string,actorUserId:string,summary:string,metadata?:Record<string,unknown>) {
  sqlite.prepare(`INSERT INTO candidate_activities (id,organization_id,candidate_id,application_id,interview_id,activity_type,actor_user_id,summary,metadata) VALUES (?,?,?,?,?,?,?,?,?)`).run(nanoid(),organizationId,candidateId,applicationId,interviewId,type,actorUserId,summary,metadata?JSON.stringify(metadata):null);
}

export function recordCandidateActivitySync(params:{organizationId:string;candidateId:string;applicationId?:string|null;interviewId?:string|null;activityType:string;actorUserId:string;summary:string;metadata?:Record<string,unknown>}):void { activity(params.organizationId,params.candidateId,params.applicationId??null,params.interviewId??null,params.activityType,params.actorUserId,assertText(params.summary,'Activity summary',500),params.metadata); }

export function createCandidateNoteInTransaction(organizationId:string,actorUserId:string,candidateId:string,applicationId:string|null,content:string):string { assertOrganizationActive(organizationId);
  const text=assertText(content,'Note',10000); return withSqliteTransactionSync(()=>{
    const c=sqlite.prepare('SELECT id FROM candidates WHERE organization_id=? AND id=?').get(organizationId,candidateId) as {id?:string}|undefined; if(!c?.id) throw new Error('Candidate not found.');
    if(applicationId){ const a=sqlite.prepare('SELECT id FROM applications WHERE organization_id=? AND id=? AND candidate_id=?').get(organizationId,applicationId,candidateId) as {id?:string}|undefined; if(!a?.id) throw new Error('Application not found for this candidate.'); }
    const id=nanoid(); sqlite.prepare('INSERT INTO candidate_notes (id,organization_id,candidate_id,application_id,author_user_id,content) VALUES (?,?,?,?,?,?)').run(id,organizationId,candidateId,applicationId,actorUserId,text);
    activity(organizationId,candidateId,applicationId,null,'candidate_note_added',actorUserId,'Recruitment note added');
    recordAuditSync({organizationId,actorUserId,action:'recruitment_note_added',entityType:'candidate_note',entityId:id}); return id;
  });
}
export function updateCandidateNoteInTransaction(organizationId:string,actorUserId:string,noteId:string,content:string):void { assertOrganizationActive(organizationId);
  const text=assertText(content,'Note',10000); withSqliteTransactionSync(()=>{ const n=sqlite.prepare('SELECT id,candidate_id,application_id,author_user_id FROM candidate_notes WHERE organization_id=? AND id=?').get(organizationId,noteId) as any; if(!n?.id) throw new Error('Note not found.'); sqlite.prepare('UPDATE candidate_notes SET content=?,updated_at=current_timestamp WHERE organization_id=? AND id=?').run(text,organizationId,noteId); activity(organizationId,n.candidate_id,n.application_id,null,'candidate_note_updated',actorUserId,'Recruitment note updated'); recordAuditSync({organizationId,actorUserId,action:'recruitment_note_updated',entityType:'candidate_note',entityId:noteId}); });
}

function assertApplication(org:string,id:string):any { const r=sqlite.prepare('SELECT a.id,a.status,a.current_stage,a.candidate_id,c.first_name,c.last_name,c.email,j.requisition_code,j.title FROM applications a JOIN candidates c ON c.organization_id=a.organization_id AND c.id=a.candidate_id JOIN job_requisitions j ON j.organization_id=a.organization_id AND j.id=a.requisition_id WHERE a.organization_id=? AND a.id=?').get(org,id) as any; if(!r) throw new Error('Application not found.'); return r; }
function assertUser(org:string,id:string):void { const r=sqlite.prepare('SELECT id FROM users WHERE organization_id=? AND id=? AND is_active=1').get(org,id) as any; if(!r?.id) throw new Error('Interviewer is not an active member of your organization.'); }
function activeConflict(org:string,userId:string,start:string,end:string,excludeId:string|null):boolean { const q=`SELECT i.id FROM interviews i JOIN interview_participants p ON p.organization_id=i.organization_id AND p.interview_id=i.id WHERE i.organization_id=? AND p.user_id=? AND i.status IN ('scheduled','confirmed','rescheduled','no_show') AND i.scheduled_start < ? AND i.scheduled_end > ? ${excludeId?'AND i.id <> ?':''} LIMIT 1`; const r=excludeId?sqlite.prepare(q).get(org,userId,end,start,excludeId):sqlite.prepare(q).get(org,userId,end,start); return Boolean((r as any)?.id); }

function transitionApplicationInTx(org:string,actor:string,applicationId:string,next:WorkflowStatus,reason:string) {
  const row=assertApplication(org,applicationId); const prev=assertStatus(row.status); if(!canTransitionWorkflow(prev,next)) throw new Error(`Cannot move a ${prev} application to ${next}.`);
  const targetStage=sqlite.prepare('SELECT is_active FROM recruitment_stages WHERE organization_id=? AND status_key=?').get(org,next) as {is_active?:number}|undefined; if(!targetStage || Number(targetStage.is_active)!==1) throw new Error('The target workflow stage is inactive.');
  sqlite.prepare('UPDATE applications SET status=?,current_stage=?,updated_at=? WHERE organization_id=? AND id=?').run(next,next,new Date().toISOString(),org,applicationId);
  sqlite.prepare('INSERT INTO application_history (id,organization_id,application_id,previous_status,new_status,previous_stage,new_stage,actor_user_id,reason,note) VALUES (?,?,?,?,?,?,?,?,?,?)').run(nanoid(),org,applicationId,prev,next,prev,next,actor,reason,null);
  activity(org,row.candidate_id,applicationId,null,'stage_changed',actor,`Application moved from ${stageLabel(prev)} to ${stageLabel(next)}`,{previousStatus:prev,newStatus:next});
  if(next==='rejected') activity(org,row.candidate_id,applicationId,null,'rejection',actor,'Application rejected');
  if(next==='withdrawn') activity(org,row.candidate_id,applicationId,null,'withdrawal',actor,'Application withdrawn');
  if(next==='archived') activity(org,row.candidate_id,applicationId,null,'archive',actor,'Application archived');
  recordAuditSync({organizationId:org,actorUserId:actor,action:'application_stage_changed',entityType:'application',entityId:applicationId,metadata:{previousStatus:prev,newStatus:next,reason}});
}

export function changeApplicationWorkflowInTransaction(org:string,actor:string,applicationId:string,nextStatus:string,reason:string):void { assertOrganizationActive(org); const next=assertStatus(nextStatus); const why=assertText(reason||'Workflow transition', 'Reason', 1000); withSqliteTransactionSync(()=>transitionApplicationInTx(org,actor,applicationId,next,why)); }

export function createInterviewInTransaction(input:{organizationId:string;actorUserId:string;applicationId:string;roundId:string|null;roundName:string;title:string;interviewType:string;startLocal:string;endLocal:string;timezone:string;location:string|null;meetingDetails:string|null;participantIds:string[]}):string {
  assertOrganizationActive(input.organizationId);
  const title=assertText(input.title,'Interview title',200); const type=assertText(input.interviewType,'Interview type',80); if(!INTERVIEW_TYPES.includes(type as any)) throw new Error('Invalid interview type.'); const tz=assertTimezone(input.timezone); const schedule=validateSchedule(input.startLocal,input.endLocal,tz); const participants=[...new Set(input.participantIds.filter(Boolean))]; if(participants.length===0) throw new Error('Assign at least one interviewer.');
  return withSqliteTransactionSync(()=>{
    const app=assertApplication(input.organizationId,input.applicationId); const current=assertStatus(app.status); if(!['shortlisted','interview'].includes(current)) throw new Error('Interviews can only be scheduled for shortlisted or interview-stage applications.');
    for(const uid of participants){ assertUser(input.organizationId,uid); if(activeConflict(input.organizationId,uid,schedule.start,schedule.end,null)) throw new Error('One or more interviewers already have an overlapping interview.'); }
    let roundId=input.roundId;
    if(roundId){ const r=sqlite.prepare('SELECT id FROM interview_rounds WHERE organization_id=? AND id=? AND application_id=?').get(input.organizationId,roundId,input.applicationId) as any; if(!r?.id) throw new Error('Interview round not found for this application.'); }
    else { const max=sqlite.prepare('SELECT COALESCE(MAX(round_number),0) n FROM interview_rounds WHERE organization_id=? AND application_id=?').get(input.organizationId,input.applicationId) as any; const num=Number(max?.n??0)+1; roundId=nanoid(); const rn=assertText(input.roundName||`Round ${num}`,'Round name',120); sqlite.prepare('INSERT INTO interview_rounds (id,organization_id,application_id,round_number,name,stage_status,created_by) VALUES (?,?,?,?,?,?,?)').run(roundId,input.organizationId,input.applicationId,num,rn,'interview',input.actorUserId); }
    if(current==='shortlisted') transitionApplicationInTx(input.organizationId,input.actorUserId,input.applicationId,'interview','Interview scheduled');
    const id=nanoid(); sqlite.prepare(`INSERT INTO interviews (id,organization_id,application_id,round_id,title,interview_type,status,scheduled_start,scheduled_end,timezone,location,meeting_details,organizer_user_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,input.organizationId,input.applicationId,roundId,title,type,'scheduled',schedule.start,schedule.end,tz,assertOptionalText(input.location,'Location',500),assertOptionalText(input.meetingDetails,'Meeting details',2000),input.actorUserId,input.actorUserId);
    for(const uid of participants){ sqlite.prepare('INSERT INTO interview_participants (id,organization_id,interview_id,user_id,role,assigned_by) VALUES (?,?,?,?,?,?)').run(nanoid(),input.organizationId,id,uid,'interviewer',input.actorUserId); activity(input.organizationId,app.candidate_id,input.applicationId,id,'interviewer_assigned',input.actorUserId,'Interviewer assigned',{userId:uid}); }
    activity(input.organizationId,app.candidate_id,input.applicationId,id,'interview_scheduled',input.actorUserId,`Interview scheduled: ${title}`,{scheduledStart:schedule.start,scheduledEnd:schedule.end,timezone:tz});
    recordAuditSync({organizationId:input.organizationId,actorUserId:input.actorUserId,action:'interview_created',entityType:'interview',entityId:id,metadata:{applicationId:input.applicationId,participantCount:participants.length}}); return id;
  });
}

export function rescheduleInterviewInTransaction(org:string,actor:string,interviewId:string,startLocal:string,endLocal:string,timezone:string):void { assertOrganizationActive(org); const s=validateSchedule(startLocal,endLocal,timezone); withSqliteTransactionSync(()=>{ const i=sqlite.prepare('SELECT id,application_id,status FROM interviews WHERE organization_id=? AND id=?').get(org,interviewId) as any; if(!i?.id) throw new Error('Interview not found.'); const st=assertInterviewStatus(i.status); if(!['scheduled','confirmed','rescheduled'].includes(st)) throw new Error('Only active interviews can be rescheduled.'); const ps=sqlite.prepare('SELECT user_id FROM interview_participants WHERE organization_id=? AND interview_id=?').all(org,interviewId) as any[]; for(const p of ps) if(activeConflict(org,p.user_id,s.start,s.end,interviewId)) throw new Error('One or more interviewers already have an overlapping interview.'); sqlite.prepare('UPDATE interviews SET scheduled_start=?,scheduled_end=?,timezone=?,status=?,updated_at=? WHERE organization_id=? AND id=?').run(s.start,s.end,s.timezone,'rescheduled',new Date().toISOString(),org,interviewId); const app=assertApplication(org,i.application_id); activity(org,app.candidate_id,i.application_id,interviewId,'interview_rescheduled',actor,'Interview rescheduled',{scheduledStart:s.start,scheduledEnd:s.end,timezone:s.timezone}); recordAuditSync({organizationId:org,actorUserId:actor,action:'interview_rescheduled',entityType:'interview',entityId:interviewId}); }); }
export function changeInterviewStatusInTransaction(org:string,actor:string,interviewId:string,nextStatus:string):void { assertOrganizationActive(org); const next=assertInterviewStatus(nextStatus); withSqliteTransactionSync(()=>{ const i=sqlite.prepare('SELECT id,application_id,status,title FROM interviews WHERE organization_id=? AND id=?').get(org,interviewId) as any; if(!i?.id) throw new Error('Interview not found.'); const prev=assertInterviewStatus(i.status); if(!canTransitionInterview(prev,next)) throw new Error(`Cannot move a ${prev} interview to ${next}.`); sqlite.prepare('UPDATE interviews SET status=?,updated_at=? WHERE organization_id=? AND id=?').run(next,new Date().toISOString(),org,interviewId); const app=assertApplication(org,i.application_id); const type=next==='cancelled'?'interview_cancelled':next==='completed'?'interview_completed':next==='no_show'?'interview_no_show':'interview_status_changed'; activity(org,app.candidate_id,i.application_id,interviewId,type,actor,`Interview ${stageLabel(next)}`); recordAuditSync({organizationId:org,actorUserId:actor,action:'interview_status_changed',entityType:'interview',entityId:interviewId,metadata:{previousStatus:prev,newStatus:next}}); }); }

export function assignInterviewParticipantInTransaction(org:string,actor:string,interviewId:string,userId:string):void { assertOrganizationActive(org); withSqliteTransactionSync(()=>{ const i=sqlite.prepare('SELECT id,application_id,status,scheduled_start,scheduled_end FROM interviews WHERE organization_id=? AND id=?').get(org,interviewId) as any; if(!i?.id) throw new Error('Interview not found.'); if(['completed','cancelled','no_show'].includes(i.status)) throw new Error('Participants cannot be changed on a closed interview.'); assertUser(org,userId); if(activeConflict(org,userId,i.scheduled_start,i.scheduled_end,interviewId)) throw new Error('This interviewer has an overlapping interview.'); try{sqlite.prepare('INSERT INTO interview_participants (id,organization_id,interview_id,user_id,role,assigned_by) VALUES (?,?,?,?,?,?)').run(nanoid(),org,interviewId,userId,'interviewer',actor);}catch(e){throw new Error('This interviewer is already assigned to the interview.');} const app=assertApplication(org,i.application_id); activity(org,app.candidate_id,i.application_id,interviewId,'interviewer_assigned',actor,'Interviewer assigned',{userId}); recordAuditSync({organizationId:org,actorUserId:actor,action:'interviewer_assigned',entityType:'interview',entityId:interviewId,metadata:{userId}}); }); }
export function removeInterviewParticipantInTransaction(org:string,actor:string,interviewId:string,userId:string):void { assertOrganizationActive(org); withSqliteTransactionSync(()=>{ const i=sqlite.prepare('SELECT id,application_id,status FROM interviews WHERE organization_id=? AND id=?').get(org,interviewId) as any; if(!i?.id) throw new Error('Interview not found.'); if(['completed','cancelled','no_show'].includes(i.status)) throw new Error('Participants cannot be changed on a closed interview.'); const count=sqlite.prepare('SELECT COUNT(*) n FROM interview_participants WHERE organization_id=? AND interview_id=?').get(org,interviewId) as any; if(Number(count?.n??0)<=1) throw new Error('An interview must retain at least one interviewer.'); const r=sqlite.prepare('DELETE FROM interview_participants WHERE organization_id=? AND interview_id=? AND user_id=?').run(org,interviewId,userId); if(Number(r.changes)===0) throw new Error('Interviewer assignment not found.'); const app=assertApplication(org,i.application_id); activity(org,app.candidate_id,i.application_id,interviewId,'interviewer_removed',actor,'Interviewer removed',{userId}); recordAuditSync({organizationId:org,actorUserId:actor,action:'interviewer_removed',entityType:'interview',entityId:interviewId,metadata:{userId}}); }); }

export function submitInterviewFeedbackInTransaction(org:string,actor:string,interviewId:string,score:number,recommendation:string,strengths:string,concerns:string,notes:string|null):string { assertOrganizationActive(org); if(!Number.isInteger(score)||score<1||score>5) throw new Error('Score must be an integer from 1 to 5.'); if(!FEEDBACK_RECOMMENDATIONS.includes(recommendation as FeedbackRecommendation)) throw new Error('Invalid recommendation.'); const st=assertText(strengths,'Strengths',5000), co=assertText(concerns,'Concerns',5000), no=assertOptionalText(notes,'Notes',5000); return withSqliteTransactionSync(()=>{ const i=sqlite.prepare('SELECT id,application_id,status FROM interviews WHERE organization_id=? AND id=?').get(org,interviewId) as any; if(!i?.id) throw new Error('Interview not found.'); if(i.status!=='completed') throw new Error('Feedback can only be submitted after an interview is completed.'); const assigned=sqlite.prepare('SELECT id FROM interview_participants WHERE organization_id=? AND interview_id=? AND user_id=? AND role=?').get(org,interviewId,actor,'interviewer') as any; if(!assigned?.id) throw new Error('Only assigned interviewers can submit feedback.'); const exists=sqlite.prepare('SELECT id FROM interview_feedback WHERE organization_id=? AND interview_id=? AND interviewer_user_id=?').get(org,interviewId,actor) as any; if(exists?.id) throw new Error('You have already submitted feedback for this interview.'); const id=nanoid(); sqlite.prepare('INSERT INTO interview_feedback (id,organization_id,interview_id,interviewer_user_id,score,recommendation,strengths,concerns,notes) VALUES (?,?,?,?,?,?,?,?,?)').run(id,org,interviewId,actor,score,recommendation,st,co,no); const app=assertApplication(org,i.application_id); activity(org,app.candidate_id,i.application_id,interviewId,'feedback_submitted',actor,'Interview feedback submitted'); recordAuditSync({organizationId:org,actorUserId:actor,action:'interview_feedback_submitted',entityType:'interview_feedback',entityId:id,metadata:{interviewId,score,recommendation}}); return id; }); }

export function correctInterviewFeedbackInTransaction(org:string,actor:string,feedbackId:string,input:{score:number;recommendation:string;strengths:string;concerns:string;notes:string|null;reason:string}):void { assertOrganizationActive(org); if(!Number.isInteger(input.score)||input.score<1||input.score>5) throw new Error('Score must be an integer from 1 to 5.'); if(!FEEDBACK_RECOMMENDATIONS.includes(input.recommendation as FeedbackRecommendation)) throw new Error('Invalid recommendation.'); const reason=assertText(input.reason,'Correction reason',1000); withSqliteTransactionSync(()=>{ const f=sqlite.prepare('SELECT * FROM interview_feedback WHERE organization_id=? AND id=?').get(org,feedbackId) as any; if(!f) throw new Error('Feedback not found.'); const latest=sqlite.prepare('SELECT * FROM interview_feedback_corrections WHERE organization_id=? AND feedback_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(org,feedbackId) as any; const prev=latest?{score:latest.new_score,recommendation:latest.new_recommendation,strengths:latest.new_strengths,concerns:latest.new_concerns,notes:latest.new_notes}:{score:f.score,recommendation:f.recommendation,strengths:f.strengths,concerns:f.concerns,notes:f.notes}; const ns=assertText(input.strengths,'Strengths',5000),nc=assertText(input.concerns,'Concerns',5000),nn=assertOptionalText(input.notes,'Notes',5000); const id=nanoid(); sqlite.prepare(`INSERT INTO interview_feedback_corrections (id,organization_id,feedback_id,previous_score,previous_recommendation,previous_strengths,previous_concerns,previous_notes,new_score,new_recommendation,new_strengths,new_concerns,new_notes,corrected_by,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,org,feedbackId,prev.score,prev.recommendation,prev.strengths,prev.concerns,prev.notes,input.score,input.recommendation,ns,nc,nn,actor,reason); const i=sqlite.prepare('SELECT application_id FROM interviews WHERE organization_id=? AND id=?').get(org,f.interview_id) as any; const app=assertApplication(org,i.application_id); activity(org,app.candidate_id,i.application_id,f.interview_id,'feedback_corrected',actor,'Interview feedback corrected',{feedbackId,reason}); recordAuditSync({organizationId:org,actorUserId:actor,action:'interview_feedback_corrected',entityType:'interview_feedback',entityId:feedbackId,metadata:{correctionId:id,reason}}); }); }

export function recordInterviewDecisionInTransaction(org:string,actor:string,interviewId:string,outcome:string,rationale:string):string { assertOrganizationActive(org); if(!DECISION_OUTCOMES.includes(outcome as DecisionOutcome)) throw new Error('Invalid interview decision.'); const why=assertText(rationale,'Decision rationale',5000); return withSqliteTransactionSync(()=>{ const i=sqlite.prepare('SELECT id,application_id,status FROM interviews WHERE organization_id=? AND id=?').get(org,interviewId) as any; if(!i?.id) throw new Error('Interview not found.'); if(i.status!=='completed') throw new Error('Decisions can only be recorded after an interview is completed.'); const exists=sqlite.prepare('SELECT id FROM interview_decisions WHERE organization_id=? AND interview_id=?').get(org,interviewId) as any; if(exists?.id) throw new Error('A decision has already been recorded for this interview.'); const id=nanoid(); sqlite.prepare('INSERT INTO interview_decisions (id,organization_id,interview_id,application_id,outcome,rationale,decided_by) VALUES (?,?,?,?,?,?,?)').run(id,org,interviewId,i.application_id,outcome,why,actor); if(outcome==='reject'){ const app=assertApplication(org,i.application_id); if(canTransitionWorkflow(assertStatus(app.status),'rejected')) transitionApplicationInTx(org,actor,i.application_id,'rejected','Interview decision: reject'); else throw new Error('The application cannot be rejected from its current workflow state.'); } else if(outcome==='advance'){ const app=assertApplication(org,i.application_id); if(canTransitionWorkflow(assertStatus(app.status),'evaluation')) transitionApplicationInTx(org,actor,i.application_id,'evaluation','Interview decision: advance'); else throw new Error('The application cannot advance from its current workflow state.'); } const app=assertApplication(org,i.application_id); activity(org,app.candidate_id,i.application_id,interviewId,'decision_recorded',actor,`Interview decision: ${stageLabel(outcome)}`,{outcome}); recordAuditSync({organizationId:org,actorUserId:actor,action:'interview_decision_recorded',entityType:'interview_decision',entityId:id,metadata:{outcome}}); return id; }); }

export async function listUpcomingInterviews(organizationId:string,limit=12) { const lim=Math.max(1,Math.min(limit,50)); return db.select().from(interviews).where(and(eq(interviews.organizationId,organizationId),eq(interviews.status,'scheduled'))).orderBy(asc(interviews.scheduledStart)).limit(lim); }

export function getInterview(organizationId:string,id:string) { const i=sqlite.prepare(`SELECT i.*,r.round_number,r.name round_name,a.application_reference,a.status application_status,a.candidate_id,c.first_name,c.last_name,c.email,j.requisition_code,j.title job_title FROM interviews i JOIN interview_rounds r ON r.organization_id=i.organization_id AND r.id=i.round_id JOIN applications a ON a.organization_id=i.organization_id AND a.id=i.application_id JOIN candidates c ON c.organization_id=i.organization_id AND c.id=a.candidate_id JOIN job_requisitions j ON j.organization_id=i.organization_id AND j.id=a.requisition_id WHERE i.organization_id=? AND i.id=?`).get(organizationId,id) as any; if(!i) return null; const participants=sqlite.prepare(`SELECT p.user_id,p.role,u.email,e.first_name,e.last_name FROM interview_participants p JOIN users u ON u.organization_id=p.organization_id AND u.id=p.user_id LEFT JOIN employees e ON e.organization_id=u.organization_id AND e.id=u.employee_id WHERE p.organization_id=? AND p.interview_id=? ORDER BY e.first_name,e.last_name,u.email`).all(organizationId,id) as any[]; const feedback=sqlite.prepare(`SELECT f.*,u.email FROM interview_feedback f JOIN users u ON u.organization_id=f.organization_id AND u.id=f.interviewer_user_id WHERE f.organization_id=? AND f.interview_id=? ORDER BY f.submitted_at`).all(organizationId,id) as any[]; const corrections=sqlite.prepare('SELECT * FROM interview_feedback_corrections WHERE organization_id=? AND feedback_id IN (SELECT id FROM interview_feedback WHERE organization_id=? AND interview_id=?) ORDER BY created_at,id').all(organizationId,organizationId,id) as any[]; for(const f of feedback){const c=[...corrections].reverse().find((x:any)=>x.feedback_id===f.id); if(c){f.score=c.new_score;f.recommendation=c.new_recommendation;f.strengths=c.new_strengths;f.concerns=c.new_concerns;f.notes=c.new_notes;f.corrected_at=c.created_at;}} const decision=sqlite.prepare('SELECT d.*,u.email decided_by_email FROM interview_decisions d JOIN users u ON u.organization_id=d.organization_id AND u.id=d.decided_by WHERE d.organization_id=? AND d.interview_id=?').get(organizationId,id) as any; return {interview:i,participants,feedback,corrections,decision}; }

export function canViewInterview(organizationId:string,userId:string,role:string,interviewId:string):boolean { if(role==='admin'||role==='hr') return Boolean(sqlite.prepare('SELECT id FROM interviews WHERE organization_id=? AND id=?').get(organizationId,interviewId)); return Boolean(sqlite.prepare('SELECT i.id FROM interviews i JOIN interview_participants p ON p.organization_id=i.organization_id AND p.interview_id=i.id WHERE i.organization_id=? AND i.id=? AND p.user_id=?').get(organizationId,interviewId,userId)); }

export function listInterviews(organizationId:string,status:string='',from:string='',to:string='',interviewer:string='') { const clauses=['i.organization_id=?']; const params:any[]=[organizationId]; if(INTERVIEW_STATUSES.includes(status as InterviewStatus)){clauses.push('i.status=?');params.push(status);} if(from){clauses.push('i.scheduled_start>=?');params.push(from);} if(to){clauses.push('i.scheduled_start<=?');params.push(to);} if(interviewer){clauses.push('EXISTS (SELECT 1 FROM interview_participants pp WHERE pp.organization_id=i.organization_id AND pp.interview_id=i.id AND pp.user_id=?)');params.push(interviewer);} return sqlite.prepare(`SELECT i.id,i.title,i.status,i.scheduled_start,i.scheduled_end,i.timezone,i.application_id,a.application_reference,c.first_name,c.last_name,j.requisition_code,j.title job_title,(SELECT COUNT(*) FROM interview_participants pp WHERE pp.organization_id=i.organization_id AND pp.interview_id=i.id) participant_count FROM interviews i JOIN applications a ON a.organization_id=i.organization_id AND a.id=i.application_id JOIN candidates c ON c.organization_id=i.organization_id AND c.id=a.candidate_id JOIN job_requisitions j ON j.organization_id=i.organization_id AND j.id=a.requisition_id WHERE ${clauses.join(' AND ')} ORDER BY i.scheduled_start DESC LIMIT 200`).all(...params) as any[]; }


export function getApplicationWorkflow(organizationId:string,applicationId:string){
  const app=sqlite.prepare(`SELECT a.*,c.first_name,c.last_name,c.email,c.phone,c.location,j.requisition_code,j.title job_title,j.recruiter_user_id,j.hiring_manager_employee_id FROM applications a JOIN candidates c ON c.organization_id=a.organization_id AND c.id=a.candidate_id JOIN job_requisitions j ON j.organization_id=a.organization_id AND j.id=a.requisition_id WHERE a.organization_id=? AND a.id=?`).get(organizationId,applicationId) as any;
  if(!app) return null;
  const history=sqlite.prepare('SELECT * FROM application_history WHERE organization_id=? AND application_id=? ORDER BY created_at DESC,id DESC').all(organizationId,applicationId) as any[];
  const interviews=sqlite.prepare(`SELECT i.id,i.title,i.status,i.scheduled_start,i.scheduled_end,i.timezone,i.interview_type,r.round_number,r.name round_name FROM interviews i JOIN interview_rounds r ON r.organization_id=i.organization_id AND r.id=i.round_id WHERE i.organization_id=? AND i.application_id=? ORDER BY i.scheduled_start DESC`).all(organizationId,applicationId) as any[];
  const notes=sqlite.prepare(`SELECT n.*,u.email author_email FROM candidate_notes n JOIN users u ON u.organization_id=n.organization_id AND u.id=n.author_user_id WHERE n.organization_id=? AND n.application_id=? ORDER BY n.created_at DESC,n.id DESC LIMIT 100`).all(organizationId,applicationId) as any[];
  const activities=sqlite.prepare(`SELECT ca.*,u.email actor_email FROM candidate_activities ca JOIN users u ON u.organization_id=ca.organization_id AND u.id=ca.actor_user_id WHERE ca.organization_id=? AND ca.application_id=? ORDER BY ca.created_at DESC,ca.id DESC LIMIT 200`).all(organizationId,applicationId) as any[];
  return {application:app,history,interviews,notes,activities};
}

export function getCandidateWorkflow(organizationId:string,candidateId:string) { const c=sqlite.prepare('SELECT * FROM candidates WHERE organization_id=? AND id=?').get(organizationId,candidateId) as any; if(!c) return null; const apps=sqlite.prepare(`SELECT a.*,j.requisition_code,j.title job_title FROM applications a JOIN job_requisitions j ON j.organization_id=a.organization_id AND j.id=a.requisition_id WHERE a.organization_id=? AND a.candidate_id=? ORDER BY a.updated_at DESC`).all(organizationId,candidateId) as any[]; const activities=sqlite.prepare(`SELECT ca.*,u.email actor_email FROM candidate_activities ca JOIN users u ON u.organization_id=ca.organization_id AND u.id=ca.actor_user_id WHERE ca.organization_id=? AND ca.candidate_id=? ORDER BY ca.created_at DESC,ca.id DESC LIMIT 200`).all(organizationId,candidateId) as any[]; const notes=sqlite.prepare(`SELECT n.*,u.email author_email FROM candidate_notes n JOIN users u ON u.organization_id=n.organization_id AND u.id=n.author_user_id WHERE n.organization_id=? AND n.candidate_id=? ORDER BY n.created_at DESC,n.id DESC LIMIT 100`).all(organizationId,candidateId) as any[]; const interviews=sqlite.prepare(`SELECT i.id,i.title,i.status,i.scheduled_start,i.scheduled_end,i.timezone,i.application_id,a.application_reference FROM interviews i JOIN applications a ON a.organization_id=i.organization_id AND a.id=i.application_id WHERE i.organization_id=? AND a.candidate_id=? ORDER BY i.scheduled_start DESC LIMIT 100`).all(organizationId,candidateId) as any[]; return {candidate:c,applications:apps,activities,notes,interviews}; }

export function getRecruitmentDashboard(organizationId:string) { const q=(sql:string,...p:any[])=>sqlite.prepare(sql).all(...p) as any[]; const one=(sql:string,...p:any[])=>sqlite.prepare(sql).get(...p) as any; return {awaitingScreening:Number(one("SELECT COUNT(*) n FROM applications WHERE organization_id=? AND status='screening'",organizationId)?.n??0),shortlisted:Number(one("SELECT COUNT(*) n FROM applications WHERE organization_id=? AND status='shortlisted'",organizationId)?.n??0),upcoming:Number(one("SELECT COUNT(*) n FROM interviews WHERE organization_id=? AND status IN ('scheduled','confirmed','rescheduled') AND scheduled_start>=?",organizationId,new Date().toISOString())?.n??0),feedbackNeeded:Number(one("SELECT COUNT(*) n FROM interviews i WHERE i.organization_id=? AND i.status='completed' AND EXISTS(SELECT 1 FROM interview_participants p WHERE p.organization_id=i.organization_id AND p.interview_id=i.id AND p.role='interviewer' AND NOT EXISTS(SELECT 1 FROM interview_feedback f WHERE f.organization_id=p.organization_id AND f.interview_id=p.interview_id AND f.interviewer_user_id=p.user_id))",organizationId)?.n??0),applicationsByStage:q("SELECT status,COUNT(*) n FROM applications WHERE organization_id=? GROUP BY status ORDER BY status",organizationId),recent:q("SELECT a.id,a.application_reference,a.status,a.updated_at,c.first_name,c.last_name,j.title FROM applications a JOIN candidates c ON c.organization_id=a.organization_id AND c.id=a.candidate_id JOIN job_requisitions j ON j.organization_id=a.organization_id AND j.id=a.requisition_id WHERE a.organization_id=? ORDER BY a.updated_at DESC LIMIT 8",organizationId)}; }

export function getInterviewFormData(organizationId:string) { const apps=sqlite.prepare(`SELECT a.id,a.application_reference,a.status,c.first_name,c.last_name,j.requisition_code,j.title job_title FROM applications a JOIN candidates c ON c.organization_id=a.organization_id AND c.id=a.candidate_id JOIN job_requisitions j ON j.organization_id=a.organization_id AND j.id=a.requisition_id WHERE a.organization_id=? AND a.status IN ('shortlisted','interview') ORDER BY a.updated_at DESC`).all(organizationId) as any[]; const people=sqlite.prepare(`SELECT u.id,u.email,e.first_name,e.last_name FROM users u LEFT JOIN employees e ON e.organization_id=u.organization_id AND e.id=u.employee_id WHERE u.organization_id=? AND u.is_active=1 ORDER BY e.first_name,e.last_name,u.email`).all(organizationId) as any[]; const rounds=sqlite.prepare(`SELECT id,application_id,round_number,name FROM interview_rounds WHERE organization_id=? ORDER BY application_id,round_number`).all(organizationId) as any[]; return {applications:apps,people,rounds}; }

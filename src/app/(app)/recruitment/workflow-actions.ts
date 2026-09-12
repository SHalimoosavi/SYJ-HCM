'use server';

import { requireRoleForAction, requireUserForAction } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  changeApplicationWorkflowInTransaction,
  changeInterviewStatusInTransaction,
  createCandidateNoteInTransaction,
  createInterviewInTransaction,
  correctInterviewFeedbackInTransaction,
  assignInterviewParticipantInTransaction,
  removeInterviewParticipantInTransaction,
  recordInterviewDecisionInTransaction,
  rescheduleInterviewInTransaction,
  submitInterviewFeedbackInTransaction,
  updateCandidateNoteInTransaction,
  updateRecruitmentStageInTransaction
} from '@/lib/recruitment-workflow';

export type WorkflowFormState = { error: string | null };
const initial: WorkflowFormState = { error: null };
const text=(fd:FormData,key:string)=>String(fd.get(key)??'').trim();
const optional=(fd:FormData,key:string)=>text(fd,key)||null;
const result=(e:unknown,fallback:string):WorkflowFormState=>({error:e instanceof Error?e.message:fallback});

export async function changeWorkflowStageAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{
  const actor=await requireRoleForAction('admin','hr'); try{changeApplicationWorkflowInTransaction(actor.organizationId,actor.id,text(fd,'applicationId'),text(fd,'status'),text(fd,'reason')||'Workflow transition'); revalidatePath('/recruitment'); revalidatePath('/recruitment/applications'); revalidatePath(`/recruitment/applications/${text(fd,'applicationId')}`); return initial;}catch(e){return result(e,'Unable to change application stage.');}
}

export async function updateStageAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireRoleForAction('admin','hr');try{updateRecruitmentStageInTransaction(actor.organizationId,actor.id,text(fd,'stageId'),text(fd,'name'),Number(text(fd,'position')),text(fd,'isActive')==='true');revalidatePath('/recruitment/stages');revalidatePath('/recruitment');return initial;}catch(e){return result(e,'Unable to update workflow stage.');}}

export async function createNoteAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireRoleForAction('admin','hr');try{const candidateId=text(fd,'candidateId');const applicationId=optional(fd,'applicationId');createCandidateNoteInTransaction(actor.organizationId,actor.id,candidateId,applicationId,text(fd,'content'));revalidatePath(`/recruitment/candidates/${candidateId}`);if(applicationId)revalidatePath(`/recruitment/applications/${applicationId}`);return initial;}catch(e){return result(e,'Unable to add note.');}}

export async function updateNoteAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireRoleForAction('admin','hr');try{updateCandidateNoteInTransaction(actor.organizationId,actor.id,text(fd,'noteId'),text(fd,'content'));revalidatePath('/recruitment/candidates');revalidatePath('/recruitment/applications');return initial;}catch(e){return result(e,'Unable to update note.');}}

export async function createInterviewAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireRoleForAction('admin','hr');let id='';try{const ids=fd.getAll('participantIds').map(String);id=createInterviewInTransaction({organizationId:actor.organizationId,actorUserId:actor.id,applicationId:text(fd,'applicationId'),roundId:optional(fd,'roundId'),roundName:text(fd,'roundName'),title:text(fd,'title'),interviewType:text(fd,'interviewType'),startLocal:text(fd,'startLocal'),endLocal:text(fd,'endLocal'),timezone:text(fd,'timezone'),location:optional(fd,'location'),meetingDetails:optional(fd,'meetingDetails'),participantIds:ids});}catch(e){return result(e,'Unable to schedule interview.');}revalidatePath('/recruitment');revalidatePath('/recruitment/interviews');revalidatePath(`/recruitment/applications/${text(fd,'applicationId')}`);redirect(`/recruitment/interviews/${id}`);}

export async function rescheduleInterviewAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireRoleForAction('admin','hr');try{rescheduleInterviewInTransaction(actor.organizationId,actor.id,text(fd,'interviewId'),text(fd,'startLocal'),text(fd,'endLocal'),text(fd,'timezone'));revalidatePath('/recruitment');revalidatePath('/recruitment/interviews');revalidatePath(`/recruitment/interviews/${text(fd,'interviewId')}`);return initial;}catch(e){return result(e,'Unable to reschedule interview.');}}

export async function interviewStatusAction(fd:FormData):Promise<void>{const actor=await requireRoleForAction('admin','hr');const id=text(fd,'interviewId');try{changeInterviewStatusInTransaction(actor.organizationId,actor.id,id,text(fd,'status'));}catch(e){redirect(`/recruitment/interviews/${id}?error=${encodeURIComponent(e instanceof Error?e.message:'Unable to update interview.')}`);}revalidatePath('/recruitment');revalidatePath('/recruitment/interviews');revalidatePath(`/recruitment/interviews/${id}`);redirect(`/recruitment/interviews/${id}`);}

export async function assignParticipantAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireRoleForAction('admin','hr');try{const id=text(fd,'interviewId');assignInterviewParticipantInTransaction(actor.organizationId,actor.id,id,text(fd,'userId'));revalidatePath(`/recruitment/interviews/${id}`);return initial;}catch(e){return result(e,'Unable to assign interviewer.');}}
export async function removeParticipantAction(fd:FormData):Promise<void>{const actor=await requireRoleForAction('admin','hr');const id=text(fd,'interviewId');try{removeInterviewParticipantInTransaction(actor.organizationId,actor.id,id,text(fd,'userId'));}catch(e){redirect(`/recruitment/interviews/${id}?error=${encodeURIComponent(e instanceof Error?e.message:'Unable to remove interviewer.')}`);}revalidatePath(`/recruitment/interviews/${id}`);redirect(`/recruitment/interviews/${id}`);}

export async function submitFeedbackAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireUserForAction();try{const id=submitInterviewFeedbackInTransaction(actor.organizationId,actor.id,text(fd,'interviewId'),Number(text(fd,'score')),text(fd,'recommendation'),text(fd,'strengths'),text(fd,'concerns'),optional(fd,'notes'));revalidatePath(`/recruitment/interviews/${text(fd,'interviewId')}`);return {error:null};}catch(e){return result(e,'Unable to submit feedback.');}}

export async function correctFeedbackAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireRoleForAction('admin','hr');try{correctInterviewFeedbackInTransaction(actor.organizationId,actor.id,text(fd,'feedbackId'),{score:Number(text(fd,'score')),recommendation:text(fd,'recommendation'),strengths:text(fd,'strengths'),concerns:text(fd,'concerns'),notes:optional(fd,'notes'),reason:text(fd,'reason')});revalidatePath(`/recruitment/interviews/${text(fd,'interviewId')}`);return initial;}catch(e){return result(e,'Unable to record feedback correction.');}}

export async function recordDecisionAction(_prev:WorkflowFormState,fd:FormData):Promise<WorkflowFormState>{const actor=await requireRoleForAction('admin','hr');try{recordInterviewDecisionInTransaction(actor.organizationId,actor.id,text(fd,'interviewId'),text(fd,'outcome'),text(fd,'rationale'));revalidatePath('/recruitment');revalidatePath('/recruitment/applications');revalidatePath(`/recruitment/interviews/${text(fd,'interviewId')}`);return initial;}catch(e){return result(e,'Unable to record interview decision.');}}

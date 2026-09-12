'use server';

import { revalidatePath } from 'next/cache';
import { requireRoleForAction } from '@/lib/auth';
import { normalizeDocumentType } from '@/lib/documents/constants';
import { archiveCandidateDocument, replaceCandidateDocument, restoreCandidateDocument, uploadCandidateDocument } from '@/lib/documents/service';

type State = { error: string | null; success?: string };
const initial: State = { error: null };

export async function uploadDocumentAction(candidateId: string, applicationId: string | null, _prev: State, fd: FormData): Promise<State> {
  const actor = await requireRoleForAction('admin','hr');
  const type = normalizeDocumentType(fd.get('documentType'));
  const file = fd.get('file');
  if (!(file instanceof File) || !type) return { error: 'Select a valid document type and file.' };
  const result = await uploadCandidateDocument({ candidateId, applicationId, documentType: type, file, actorUserId: actor.id, organizationId: actor.organizationId });
  if (!result.ok) return { error: result.error ?? 'Document upload failed.' };
  revalidatePath(`/recruitment/candidates/${candidateId}`);
  if (applicationId) revalidatePath(`/recruitment/applications/${applicationId}`);
  return { error: null, success: result.documentId ? 'Document uploaded. Scanner status is shown below.' : 'Document uploaded.' };
}

export async function archiveDocumentAction(documentId: string, candidateId: string): Promise<void> {
  const actor = await requireRoleForAction('admin','hr');
  const result = await archiveCandidateDocument(actor.organizationId, documentId, actor.id);
  revalidatePath(`/recruitment/candidates/${candidateId}`);
  if (result.applicationId) revalidatePath(`/recruitment/applications/${result.applicationId}`);
}

export async function restoreDocumentAction(documentId: string, candidateId: string): Promise<void> {
  const actor = await requireRoleForAction('admin','hr');
  const result = await restoreCandidateDocument(actor.organizationId, documentId, actor.id);
  revalidatePath(`/recruitment/candidates/${candidateId}`);
  if (result.applicationId) revalidatePath(`/recruitment/applications/${result.applicationId}`);
}

export async function replaceDocumentAction(candidateId: string, applicationId: string | null, oldDocumentId: string, _prev: State, fd: FormData): Promise<State> {
  const actor = await requireRoleForAction('admin','hr');
  const type = normalizeDocumentType(fd.get('documentType'));
  const file = fd.get('file');
  if (!(file instanceof File) || !type) return { error: 'Select a valid document type and file.' };
  const result = await replaceCandidateDocument({ organizationId: actor.organizationId, oldDocumentId, candidateId, applicationId, documentType: type, file, actorUserId: actor.id });
  if (!result.ok) return { error: result.error ?? 'Document replacement failed.' };
  revalidatePath(`/recruitment/candidates/${candidateId}`);
  if (applicationId) revalidatePath(`/recruitment/applications/${applicationId}`);
  return { error: null, success: 'Replacement uploaded; the previous record was archived.' };
}

export { initial };

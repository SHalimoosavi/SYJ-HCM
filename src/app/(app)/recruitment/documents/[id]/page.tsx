import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getAuthorizedDocument } from '@/lib/documents/service';
import { DocumentUploadForm } from '../upload-form';
export default async function DocumentPage({ params, searchParams }: { params: Promise<{id:string}>; searchParams: Promise<{replace?:string}> }) {
  const actor = await requireRole('admin','hr');
  const { id } = await params; const p = await searchParams;
  const doc = await getAuthorizedDocument(actor.organizationId,id);
  if (!doc) return <div className="card p-6">Document not found.</div>;
  if (p.replace === '1') return <div className="max-w-3xl space-y-6"><h1 className="text-2xl font-semibold">Replace document</h1><p className="text-sm text-surface-500">The existing record remains archived as history; the new upload gets its own immutable document record.</p><DocumentUploadForm candidateId={doc.candidateId} applicationId={doc.applicationId} replaceDocumentId={doc.id}/></div>;
  if (doc.lifecycleStatus === 'archived') return <div className="card p-6">This document is archived.</div>;
  redirect(`/api/recruitment/documents/${doc.id}`);
}

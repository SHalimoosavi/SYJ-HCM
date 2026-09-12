'use client';
import { useFormState, useFormStatus } from 'react-dom';
import { uploadDocumentAction, replaceDocumentAction, initial } from './actions';
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from '@/lib/documents/constants';

function Submit({ children }: { children: string }) { const { pending } = useFormStatus(); return <button className="btn-primary" disabled={pending}>{pending ? 'Uploading…' : children}</button>; }
export function DocumentUploadForm({ candidateId, applicationId = null, replaceDocumentId }: { candidateId: string; applicationId?: string | null; replaceDocumentId?: string }) {
  const action = replaceDocumentId ? replaceDocumentAction.bind(null, candidateId, applicationId, replaceDocumentId) : uploadDocumentAction.bind(null, candidateId, applicationId);
  const [state, formAction] = useFormState(action, initial);
  return <form action={formAction} encType="multipart/form-data" className="space-y-4 rounded-lg border border-surface-200 bg-surface-50 p-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <div><label className="label">Document type *</label><select className="input" name="documentType" required defaultValue="resume">{DOCUMENT_TYPES.map(t=><option key={t} value={t}>{t.replaceAll('_',' ')}</option>)}</select></div>
      <div><label className="label">File *</label><input className="input" type="file" name="file" required accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg,.webp,.gif"/><p className="mt-1 text-xs text-surface-500">PDF, DOCX, DOC, TXT or PNG/JPEG/WebP/GIF · max {MAX_DOCUMENT_BYTES / 1024 / 1024} MB</p></div>
    </div>
    {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
    {state.success && <p className="text-sm text-green-700" role="status">{state.success}</p>}
    <Submit>{replaceDocumentId ? 'Replace document' : 'Upload document'}</Submit>
  </form>;
}

'use client';
import { useTransition } from 'react';
import { archiveDocumentAction, restoreDocumentAction } from './actions';
export function DocumentArchiveButton({ documentId, candidateId, archived }: { documentId: string; candidateId: string; archived: boolean }) {
  const [pending, start] = useTransition();
  return <button className="btn-secondary" disabled={pending} onClick={()=>start(async()=>{ await (archived ? restoreDocumentAction(documentId,candidateId) : archiveDocumentAction(documentId,candidateId)); })}>{pending ? 'Working…' : archived ? 'Restore' : 'Archive'}</button>;
}

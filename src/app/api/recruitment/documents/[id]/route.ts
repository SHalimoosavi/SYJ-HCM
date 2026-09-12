import { NextResponse } from 'next/server';
import { getAuthorizedDocument } from '@/lib/documents/service';
import { getDocumentStorage } from '@/lib/documents/storage';
import { safeContentDisposition } from '@/lib/documents/constants';
import { getCurrentUser } from '@/lib/auth';
import { recordAudit } from '@/lib/audit';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{id:string}> }) {
  const { id } = await params;
  const actor = await getCurrentUser();
  if (!actor || actor.organizationStatus !== 'active') return new NextResponse('Not found.', { status: 404 });
  if (actor.role !== 'admin' && actor.role !== 'hr') {
    await recordAudit({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'candidate_document_access_denied', entityType: 'candidate_document', entityId: id, metadata: { reason: 'role_denied' } });
    return new NextResponse('Not found.', { status: 404 });
  }
  const doc = await getAuthorizedDocument(actor.organizationId,id);
  if (!doc || doc.deletedAt || doc.lifecycleStatus === 'archived' || doc.lifecycleStatus !== 'available' || doc.scanStatus !== 'clean') {
    await recordAudit({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'candidate_document_access_denied', entityType: 'candidate_document', entityId: id, metadata: { reason: 'not_found_or_unavailable' } });
    return new NextResponse('Not found.', { status: 404 });
  }
  const storage = getDocumentStorage();
  try {
    const data = await storage.get(doc.storageKey);
    await recordAudit({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'candidate_document_download', entityType: 'candidate_document', entityId: doc.id, metadata: { candidateId: doc.candidateId, applicationId: doc.applicationId, scanStatus: doc.scanStatus } });
    return new NextResponse(new Uint8Array(data), { status: 200, headers: { 'Content-Type': doc.detectedMimeType, 'Content-Disposition': safeContentDisposition(doc.sanitizedFilename), 'Content-Length': String(data.byteLength), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    await recordAudit({ organizationId: actor.organizationId, actorUserId: actor.id, action: 'candidate_document_download_failed', entityType: 'candidate_document', entityId: doc.id, metadata: { candidateId: doc.candidateId } });
    return new NextResponse('Document unavailable.', { status: 404 });
  }
}

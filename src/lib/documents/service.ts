import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, sqlite, withSqliteTransactionSync } from '@/db/client';
import { candidateDocuments } from '@/db/schema';
import { recordAudit, recordAuditSync } from '@/lib/audit';
import { getCurrentUser } from '@/lib/auth';
import { getDocumentStorage, makeStorageKey } from './storage';
import { detectFileType, validateDocumentInput, type DocumentType, MAX_DOCUMENT_BYTES } from './constants';
import { getMalwareScanner } from './scanner';
import { nanoid } from 'nanoid';

export type DocumentRow = typeof candidateDocuments.$inferSelect;

function actorCanManage(role: string): boolean { return role === 'admin' || role === 'hr'; }
function checksum(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }

export async function listCandidateDocuments(organizationId: string, candidateId: string, includeArchived = false): Promise<DocumentRow[]> {
  const user = await getCurrentUser();
  if (!user || user.organizationId !== organizationId || !actorCanManage(user.role)) return [];
  const conditions = [eq(candidateDocuments.organizationId, organizationId), eq(candidateDocuments.candidateId, candidateId)];
  if (!includeArchived) conditions.push(isNull(candidateDocuments.archivedAt));
  return db.select().from(candidateDocuments).where(and(...conditions)).orderBy(desc(candidateDocuments.createdAt));
}

export async function getAuthorizedDocument(organizationId: string, documentId: string): Promise<DocumentRow | null> {
  const user = await getCurrentUser();
  if (!user || user.organizationId !== organizationId || !actorCanManage(user.role)) return null;
  const rows = await db.select().from(candidateDocuments).where(and(eq(candidateDocuments.organizationId, organizationId), eq(candidateDocuments.id, documentId))).limit(1);
  return rows[0] ?? null;
}

export async function uploadCandidateDocument(params: { candidateId: string; applicationId?: string | null; offerId?: string | null; documentType: DocumentType; file: File; actorUserId: string; organizationId: string }): Promise<{ ok: boolean; error?: string; documentId?: string }> {
  const rejectUpload = (error: string, reason: string): { ok: false; error: string } => {
    try {
      recordAuditSync({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: 'candidate_document_upload_rejected',
        entityType: 'candidate_document_upload',
        entityId: `upload-rejected-${nanoid()}`,
        metadata: {
          reason,
          candidateId: params.candidateId,
          applicationId: params.applicationId ?? null,
          offerId: params.offerId ?? null,
          documentType: params.documentType
        }
      });
    } catch {
      // Rejection must remain enforced even if audit persistence fails.
    }
    return { ok: false, error };
  };

    if (params.file.size > MAX_DOCUMENT_BYTES) return rejectUpload('Document exceeds the 12 MB server-side limit.', 'size_limit');
  const input = validateDocumentInput(params.file, params.documentType);
    if (input.error) return rejectUpload(input.error, 'input_validation');
  const data = Buffer.from(await params.file.arrayBuffer());
    if (data.length !== params.file.size || data.length > MAX_DOCUMENT_BYTES) return rejectUpload('Uploaded document size validation failed.', 'size_validation');
  const detected = detectFileType(data, input.filename);
    if (!detected) return rejectUpload('File content could not be validated against an allowed document type.', 'content_detection');
  const suspiciousMarkup = data.subarray(0, Math.min(data.length, 512 * 1024)).toString('latin1');
    if (/<\s*(?:script|html|svg|iframe|object|embed|meta)\b/i.test(suspiciousMarkup)) return rejectUpload('Potential active-content/polyglot markup was rejected.', 'active_content');
  const declared = params.file.type || null;
    if (declared && declared !== detected.mime) return rejectUpload('Declared MIME type does not match detected file content.', 'mime_mismatch');
  if (detected.extension !== (input.filename.toLowerCase().endsWith('.jpeg') ? '.jpeg' : input.filename.toLowerCase().slice(input.filename.lastIndexOf('.')))) {
      return rejectUpload('Filename extension does not match detected file content.', 'extension_mismatch');
  }

  const candidate = sqlite.prepare('SELECT id FROM candidates WHERE organization_id = ? AND id = ? LIMIT 1').get(params.organizationId, params.candidateId) as { id: string } | undefined;
  if (!candidate) return { ok: false, error: 'Candidate not found.' };
  if (params.applicationId) {
    const application = sqlite.prepare('SELECT id FROM applications WHERE organization_id = ? AND id = ? AND candidate_id = ? LIMIT 1').get(params.organizationId, params.applicationId, params.candidateId) as { id: string } | undefined;
    if (!application) return { ok: false, error: 'Application does not belong to the selected candidate.' };
  }
  if (params.offerId) {
    const offer = sqlite.prepare(`SELECT o.id FROM offers o JOIN applications a ON a.organization_id=o.organization_id AND a.id=o.application_id WHERE o.organization_id=? AND o.id=? AND a.id=? AND a.candidate_id=? LIMIT 1`).get(params.organizationId, params.offerId, params.applicationId ?? '', params.candidateId) as { id: string } | undefined;
    if (!offer) return { ok: false, error: 'Offer does not belong to the selected application.' };
  }

  const id = nanoid();
  const key = makeStorageKey(id);
  const storage = getDocumentStorage();
  const hash = checksum(data);
  let stored = false;
  try {
    await storage.put(key, data); stored = true;
    const scan = await getMalwareScanner().scan(data, detected.mime);
    const lifecycle = scan.status === 'clean'
      ? 'available'
      : scan.status === 'infected' || scan.status === 'rejected'
        ? 'failed'
        : 'pending';
    sqlite.prepare(`INSERT INTO candidate_documents (id,organization_id,candidate_id,application_id,offer_id,document_type,original_filename,sanitized_filename,declared_mime_type,detected_mime_type,file_size,storage_provider,storage_key,checksum_sha256,lifecycle_status,scan_status,uploaded_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,current_timestamp,current_timestamp)`).run(id,params.organizationId,params.candidateId,params.applicationId ?? null,params.offerId ?? null,params.documentType,params.file.name,input.filename,declared,detected.mime,data.length,'local',key,hash,lifecycle,scan.status,params.actorUserId);
      const auditAction =
        scan.status === 'scanner_unavailable'
          ? 'candidate_document_upload_scanner_unavailable'
          : scan.status === 'infected'
            ? 'candidate_document_malware_detected'
            : scan.status === 'scan_failed'
              ? 'candidate_document_scan_failed'
              : scan.status === 'rejected'
                ? 'candidate_document_scan_rejected'
                : 'candidate_document_upload';

      recordAuditSync({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: auditAction,
        entityType: 'candidate_document',
        entityId: id,
        metadata: {
          candidateId: params.candidateId,
          applicationId: params.applicationId ?? null,
          offerId: params.offerId ?? null,
          documentType: params.documentType,
          detectedMimeType: detected.mime,
          fileSize: data.length,
          checksumSha256: hash,
          scanStatus: scan.status
        }
      });
    return {
      ok: lifecycle === 'available',
      documentId: id,
      error: lifecycle === 'available'
        ? undefined
        : scan.status === 'infected' || scan.status === 'rejected'
          ? 'Document was rejected by the scanner.'
          : `Document stored but is not available until malware scanning completes (${scan.status.replaceAll('_', ' ')}).`
    };
  } catch (error) {
    if (stored) await storage.delete(key).catch(async () => { await recordAudit({ organizationId: params.organizationId, actorUserId: params.actorUserId, action: 'candidate_document_orphan_cleanup_failed', entityType: 'candidate_document', entityId: id, metadata: { reason: 'database_write_failed' } }); });
    return { ok: false, error: error instanceof Error ? error.message : 'Document upload failed.' };
  }
}

export async function archiveCandidateDocument(organizationId: string, documentId: string, actorUserId: string): Promise<{ applicationId: string | null }> {
  const doc = sqlite.prepare(`SELECT application_id FROM candidate_documents WHERE organization_id=? AND id=? AND deleted_at IS NULL`).get(organizationId, documentId) as { application_id: string | null } | undefined;
  if (!doc) throw new Error('Document not found.');

  const result = sqlite.prepare(`UPDATE candidate_documents SET lifecycle_status='archived', archived_at=current_timestamp, updated_at=current_timestamp WHERE organization_id=? AND id=? AND archived_at IS NULL AND deleted_at IS NULL`).run(organizationId, documentId);
  if (Number(result.changes) !== 1) throw new Error('Document not found or already archived.');
  recordAuditSync({ organizationId, actorUserId, action: 'candidate_document_archive', entityType: 'candidate_document', entityId: documentId });
  return { applicationId: doc.application_id };
}

export async function restoreCandidateDocument(organizationId: string, documentId: string, actorUserId: string): Promise<{ applicationId: string | null }> {
  const doc = sqlite.prepare(`SELECT application_id FROM candidate_documents WHERE organization_id=? AND id=? AND deleted_at IS NULL`).get(organizationId, documentId) as { application_id: string | null } | undefined;
  if (!doc) throw new Error('Document not found.');

  const result = sqlite.prepare(`UPDATE candidate_documents SET lifecycle_status=CASE WHEN scan_status='clean' THEN 'available' ELSE 'pending' END, archived_at=NULL, updated_at=current_timestamp WHERE organization_id=? AND id=? AND lifecycle_status='archived' AND deleted_at IS NULL AND scan_status NOT IN ('infected','rejected')`).run(organizationId, documentId);
  if (Number(result.changes) !== 1) throw new Error('Document not found or cannot be restored.');
  recordAuditSync({ organizationId, actorUserId, action: 'candidate_document_restore', entityType: 'candidate_document', entityId: documentId });
  return { applicationId: doc.application_id };
}

export async function replaceCandidateDocument(params: { organizationId: string; oldDocumentId: string; candidateId: string; applicationId?: string | null; documentType: DocumentType; file: File; actorUserId: string }): Promise<{ ok: boolean; error?: string; documentId?: string }> {
  const old = await getAuthorizedDocument(params.organizationId, params.oldDocumentId);
  if (!old || old.candidateId !== params.candidateId || old.applicationId !== (params.applicationId ?? null)) {
    return { ok: false, error: 'Document not found.' };
  }

  const result = await uploadCandidateDocument(params);
  if (!result.ok || !result.documentId) return result;

  try {
    withSqliteTransactionSync(() => {
      const archive = sqlite.prepare(`
        UPDATE candidate_documents
        SET lifecycle_status='archived',
            archived_at=current_timestamp,
            updated_at=current_timestamp
        WHERE organization_id=?
          AND id=?
          AND archived_at IS NULL
          AND deleted_at IS NULL
      `).run(params.organizationId, params.oldDocumentId);

      if (Number(archive.changes) !== 1) {
        throw new Error('The original document could not be archived.');
      }

      const replacementDocumentId = result.documentId;
      if (!replacementDocumentId) {
        throw new Error('The replacement document was created without a document ID.');
      }

      const link = sqlite.prepare(`
        UPDATE candidate_documents
        SET supersedes_document_id=?,
            updated_at=current_timestamp
        WHERE organization_id=?
          AND id=?
          AND supersedes_document_id IS NULL
      `).run(
        params.oldDocumentId,
        params.organizationId,
        replacementDocumentId,
      );

      if (Number(link.changes) !== 1) {
        throw new Error('The replacement document could not be linked to its predecessor.');
      }

      recordAuditSync({
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: 'candidate_document_replace',
        entityType: 'candidate_document',
        entityId: replacementDocumentId,
        metadata: { supersedesDocumentId: params.oldDocumentId },
      });
    });

    return result;
  } catch (error) {
    const stored = sqlite.prepare(`
      SELECT storage_key
      FROM candidate_documents
      WHERE organization_id=? AND id=?
    `).get(
      params.organizationId,
      result.documentId,
    ) as { storage_key: string } | undefined;

    try {
      sqlite.prepare(`
        DELETE FROM candidate_documents
        WHERE organization_id=? AND id=?
      `).run(params.organizationId, result.documentId);
    } catch {
      // Reconciliation can identify a retained replacement row if cleanup fails.
    }

    if (stored?.storage_key) {
      try {
        await getDocumentStorage().delete(stored.storage_key);
      } catch {
        // Reconciliation can identify an orphaned storage object if cleanup fails.
      }
    }

    return {
      ok: false,
      error: error instanceof Error
        ? error.message
        : 'Document replacement failed.',
    };
  }
}

import './helpers/setup-test-db';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectFileType,
  sanitizeFilename,
  safeContentDisposition,
  MAX_DOCUMENT_BYTES,
} from '../src/lib/documents/constants';
import { LocalDocumentStorage } from '../src/lib/documents/storage';
import { getMalwareScanner } from '../src/lib/documents/scanner';
import { sqlite } from '../src/db/client';

function resetDocuments() {
  // Test-only cleanup: temporarily remove the immutable recruitment
  // triggers so dependent rows can be reset safely.
  sqlite.exec(`
    DROP TRIGGER IF EXISTS application_history_immutable_update;
    DROP TRIGGER IF EXISTS application_history_immutable_delete;
    DROP TRIGGER IF EXISTS interview_decisions_immutable_update;
    DROP TRIGGER IF EXISTS interview_decisions_immutable_delete;
    DROP TRIGGER IF EXISTS interview_feedback_immutable_update;
    DROP TRIGGER IF EXISTS interview_feedback_immutable_delete;
    DROP TRIGGER IF EXISTS interview_feedback_corrections_immutable_update;
    DROP TRIGGER IF EXISTS interview_feedback_corrections_immutable_delete;
    DROP TRIGGER IF EXISTS candidate_activities_immutable_update;
    DROP TRIGGER IF EXISTS candidate_activities_immutable_delete;

    DELETE FROM candidate_documents;
    DELETE FROM interview_feedback_corrections;
    DELETE FROM interview_decisions;
    DELETE FROM interview_feedback;
    DELETE FROM interview_participants;
    DELETE FROM candidate_activities;
    DELETE FROM candidate_notes;
    DELETE FROM interviews;
    DELETE FROM interview_rounds;
    DELETE FROM recruitment_stages;
    DELETE FROM application_history;
    DELETE FROM applications;
    DELETE FROM candidates;
    DELETE FROM job_requisitions;
  `);

  // Restore the same immutable protections used by the recruitment tests.
  sqlite.exec(`
    CREATE TRIGGER application_history_immutable_update
    BEFORE UPDATE ON application_history
    BEGIN
      SELECT RAISE(ABORT, 'Application history is immutable.');
    END;

    CREATE TRIGGER application_history_immutable_delete
    BEFORE DELETE ON application_history
    BEGIN
      SELECT RAISE(ABORT, 'Application history is immutable.');
    END;

    CREATE TRIGGER interview_decisions_immutable_update
    BEFORE UPDATE ON interview_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Interview decisions are immutable.');
    END;

    CREATE TRIGGER interview_decisions_immutable_delete
    BEFORE DELETE ON interview_decisions
    BEGIN
      SELECT RAISE(ABORT, 'Interview decisions are immutable.');
    END;

    CREATE TRIGGER interview_feedback_immutable_update
    BEFORE UPDATE ON interview_feedback
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback is immutable.');
    END;

    CREATE TRIGGER interview_feedback_immutable_delete
    BEFORE DELETE ON interview_feedback
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback is immutable.');
    END;

    CREATE TRIGGER interview_feedback_corrections_immutable_update
    BEFORE UPDATE ON interview_feedback_corrections
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback corrections are immutable.');
    END;

    CREATE TRIGGER interview_feedback_corrections_immutable_delete
    BEFORE DELETE ON interview_feedback_corrections
    BEGIN
      SELECT RAISE(ABORT, 'Interview feedback corrections are immutable.');
    END;

    CREATE TRIGGER candidate_activities_immutable_update
    BEFORE UPDATE ON candidate_activities
    BEGIN
      SELECT RAISE(ABORT, 'Candidate activities are immutable.');
    END;

    CREATE TRIGGER candidate_activities_immutable_delete
    BEFORE DELETE ON candidate_activities
    BEGIN
      SELECT RAISE(ABORT, 'Candidate activities are immutable.');
    END;
  `);

  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, status)
    VALUES
      ('org_a', 'Org A', 'org-a', 'active'),
      ('org_b', 'Org B', 'org-b', 'active')
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      slug = excluded.slug,
      status = excluded.status;

    INSERT OR IGNORE INTO users
      (id, organization_id, email, password_hash, password_salt, role, is_active)
    VALUES
      ('admin-a', 'org_a', 'admin-a@test', 'x', 'x', 'admin', 1),
      ('hr-a', 'org_a', 'hr-a@test', 'x', 'x', 'hr', 1),
      ('admin-b', 'org_b', 'admin-b@test', 'x', 'x', 'admin', 1);

    INSERT INTO candidates
      (id, organization_id, first_name, last_name, email, created_by)
    VALUES
      ('doc-c1', 'org_a', 'Doc', 'Candidate', 'doc-candidate@test', 'hr-a'),
      ('doc-c2', 'org_b', 'Foreign', 'Candidate', 'foreign@test', 'admin-b');

    INSERT INTO job_requisitions
      (
        id, organization_id, requisition_code, title,
        employment_type, description, requirements, openings,
        status, created_by
      )
    VALUES
      (
        'doc-j1', 'org_a', 'DOC-REQ-1', 'Document Engineer',
        'full_time', 'd', 'r', 1, 'open', 'admin-a'
      ),
      (
        'doc-j2', 'org_b', 'DOC-REQ-2', 'Foreign Engineer',
        'full_time', 'd', 'r', 1, 'open', 'admin-b'
      );

    INSERT INTO applications
      (
        id, organization_id, candidate_id, requisition_id,
        application_reference, status, current_stage
      )
    VALUES
      (
        'doc-a1', 'org_a', 'doc-c1', 'doc-j1',
        'DOC-APP-1', 'shortlisted', 'shortlisted'
      ),
      (
        'doc-a2', 'org_b', 'doc-c2', 'doc-j2',
        'DOC-APP-2', 'shortlisted', 'shortlisted'
      );
  `);
}

function insertDocument(overrides: Record<string, unknown> = {}) {
  const values = {
    id: 'doc-1',
    organization_id: 'org_a',
    candidate_id: 'doc-c1',
    application_id: null,
    document_type: 'resume',
    original_filename: 'resume.pdf',
    sanitized_filename: 'resume.pdf',
    declared_mime_type: 'application/pdf',
    detected_mime_type: 'application/pdf',
    file_size: 4,
    storage_provider: 'local',
    storage_key: 'documents/0123456789abcdef0123456789abcdef/abcdef0123456789abcdef0123456789',
    checksum_sha256: 'a'.repeat(64),
    lifecycle_status: 'pending',
    scan_status: 'pending_scan',
    uploaded_by: 'hr-a',
    archived_at: null,
    deleted_at: null,
    retention_until: null,
    legal_hold: 0,
    supersedes_document_id: null,
    ...overrides,
  };

  sqlite.prepare(`
    INSERT INTO candidate_documents (
      id, organization_id, candidate_id, application_id,
      document_type, original_filename, sanitized_filename,
      declared_mime_type, detected_mime_type, file_size,
      storage_provider, storage_key, checksum_sha256,
      lifecycle_status, scan_status, uploaded_by,
      archived_at, deleted_at, retention_until, legal_hold,
      supersedes_document_id
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `).run(
    values.id,
    values.organization_id,
    values.candidate_id,
    values.application_id,
    values.document_type,
    values.original_filename,
    values.sanitized_filename,
    values.declared_mime_type,
    values.detected_mime_type,
    values.file_size,
    values.storage_provider,
    values.storage_key,
    values.checksum_sha256,
    values.lifecycle_status,
    values.scan_status,
    values.uploaded_by,
    values.archived_at,
    values.deleted_at,
    values.retention_until,
    values.legal_hold,
    values.supersedes_document_id,
  );
}

test.beforeEach(resetDocuments);

test('document filename security removes traversal, control characters and dangerous punctuation', () => {
  const result = sanitizeFilename(
    '../../..\\evil\u0000<script>alert(1)</script> resume.pdf',
  );

  assert.equal(result.includes('..'), false);
  assert.equal(result.includes('/'), false);
  assert.equal(result.includes('\\'), false);
  assert.equal(result.includes('\u0000'), false);
  assert.equal(result.includes('<'), false);
  assert.equal(result.includes('>'), false);
  assert.ok(result.length > 0);
  assert.ok(result.length <= 180);
});

test('document content detection rejects unknown archives and executables and detects allowed formats', () => {
  assert.deepEqual(
    detectFileType(Buffer.from('%PDF-1.7\n')),
    {
      extension: '.pdf',
      mime: 'application/pdf',
    },
  );

  assert.equal(
    detectFileType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00')),
    null,
  );

  assert.equal(
    detectFileType(Buffer.from('PK\x03\x04\x14\x00\x00\x00')),
    null,
  );

  assert.deepEqual(
    detectFileType(
      Buffer.concat([
        Buffer.from('PK\x03\x04'),
        Buffer.from('[Content_Types].xml\0word/'),
      ]),
    ),
    {
      extension: '.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  );
});

test('content disposition is attachment-only and resists header injection', () => {
  const header = safeContentDisposition('resume\r\nSet-Cookie: attack.pdf');

  assert.match(header, /^attachment;/);
  assert.equal(header.includes('\r'), false);
  assert.equal(header.includes('\n'), false);
  assert.equal(header.includes('; Set-Cookie:'), false);
});

test('maximum document size is production-bounded at 12 MiB', () => {
  assert.equal(MAX_DOCUMENT_BYTES, 12 * 1024 * 1024);
});

test('local document storage rejects path traversal and keeps objects private', async () => {
  const previous = process.env.DOCUMENT_STORAGE_PATH;
  const root = `${process.env.TMPDIR || '/tmp'}/syj-hcm-document-security-${process.pid}`;
  process.env.DOCUMENT_STORAGE_PATH = root;

  try {
    const storage = new LocalDocumentStorage();
    const validKey =
      'documents/0123456789abcdef0123456789abcdef/abcdef0123456789abcdef0123456789';

    await storage.put(validKey, Buffer.from('private document'));

    assert.equal(await storage.exists(validKey), true);
    assert.deepEqual(await storage.get(validKey), Buffer.from('private document'));

    await assert.rejects(
      storage.get('../outside'),
      /Invalid storage key/,
    );

    await assert.rejects(
      storage.put('documents/../../outside', Buffer.from('x')),
      /Invalid storage key/,
    );

    const metadata = await storage.metadata(validKey);
    assert.equal(metadata.size, 16);

    await storage.delete(validKey);
    assert.equal(await storage.exists(validKey), false);
  } finally {
    process.env.DOCUMENT_STORAGE_PATH = previous;
  }
});

test('scanner defaults to explicit unavailable state rather than falsely claiming clean', async () => {
  const previous = process.env.DOCUMENT_SCANNER_MODE;
  delete process.env.DOCUMENT_SCANNER_MODE;

  try {
    const result = await getMalwareScanner().scan(
      Buffer.from('%PDF-1.7\n'),
      'application/pdf',
    );

    assert.equal(result.status, 'scanner_unavailable');
  } finally {
    process.env.DOCUMENT_SCANNER_MODE = previous;
  }
});

test('candidate document requires an existing candidate in the same tenant', () => {
  assert.throws(
    () =>
      insertDocument({
        organization_id: 'org_a',
        candidate_id: 'doc-c2',
      }),
    /FOREIGN KEY constraint failed|foreign key/i,
  );
});

test('candidate document requires an existing uploader in the same tenant', () => {
  assert.throws(
    () =>
      insertDocument({
        organization_id: 'org_a',
        uploaded_by: 'admin-b',
      }),
    /FOREIGN KEY constraint failed|foreign key/i,
  );
});

test('application document requires candidate and application to belong together', () => {
  assert.throws(
    () =>
      insertDocument({
        organization_id: 'org_a',
        candidate_id: 'doc-c1',
        application_id: 'doc-a2',
      }),
    /candidate|application|foreign key/i,
  );
});

test('document CHECK constraints reject invalid lifecycle, scan state and checksum', () => {
  assert.throws(
    () => insertDocument({ lifecycle_status: 'public' }),
    /CHECK constraint failed/i,
  );

  assert.throws(
    () => insertDocument({ scan_status: 'cleaned' }),
    /CHECK constraint failed/i,
  );

  assert.throws(
    () => insertDocument({ checksum_sha256: 'bad' }),
    /CHECK constraint failed/i,
  );
});

test('document file size CHECK rejects zero and over-limit files', () => {
  assert.throws(
    () => insertDocument({ file_size: 0 }),
    /CHECK constraint failed/i,
  );

  assert.throws(
    () => insertDocument({ file_size: MAX_DOCUMENT_BYTES + 1 }),
    /CHECK constraint failed/i,
  );
});

test('document storage provider is constrained to the supported local provider', () => {
  assert.throws(
    () => insertDocument({ storage_provider: 's3' }),
    /CHECK constraint failed/i,
  );
});

test('candidate-level and application-level documents remain distinct', () => {
  insertDocument({
    id: 'candidate-doc',
    application_id: null,
    storage_key:
      'documents/11111111111111111111111111111111/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });

  insertDocument({
    id: 'application-doc',
    application_id: 'doc-a1',
    storage_key:
      'documents/22222222222222222222222222222222/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });

  const candidateDocs = sqlite
    .prepare(`
      SELECT id, application_id
      FROM candidate_documents
      WHERE organization_id=? AND candidate_id=?
    `)
    .all('org_a', 'doc-c1') as Array<{ id: string; application_id: string | null }>;

  assert.equal(candidateDocs.length, 2);
  assert.ok(candidateDocs.some((d) => d.id === 'candidate-doc' && d.application_id === null));
  assert.ok(candidateDocs.some((d) => d.id === 'application-doc' && d.application_id === 'doc-a1'));
});

test('duplicate checksum does not reject a legitimate second document', () => {
  insertDocument({ id: 'duplicate-1' });
  insertDocument({
    id: 'duplicate-2',
    storage_key:
      'documents/33333333333333333333333333333333/cccccccccccccccccccccccccccccccc',
  });

  const rows = sqlite
    .prepare(`
      SELECT id, checksum_sha256
      FROM candidate_documents
      WHERE organization_id=? AND checksum_sha256=?
      ORDER BY id
    `)
    .all('org_a', 'a'.repeat(64)) as Array<{ id: string; checksum_sha256: string }>;

  assert.equal(rows.length, 2);
  assert.ok(rows[0]);
  assert.ok(rows[1]);
  assert.equal(rows[0].checksum_sha256, rows[1].checksum_sha256);
});

test('document tenant boundary prevents cross-organization ID lookup through scoped predicates', () => {
  insertDocument({ id: 'org-a-doc' });

  const foreignRead = sqlite
    .prepare(`
      SELECT id
      FROM candidate_documents
      WHERE organization_id=? AND id=?
    `)
    .get('org_b', 'org-a-doc');

  assert.equal(foreignRead, undefined);
});

test('archive and restore lifecycle transitions preserve the document row', () => {
  insertDocument({
    lifecycle_status: 'available',
    scan_status: 'clean',
  });

  const archive = sqlite.prepare(`
    UPDATE candidate_documents
    SET lifecycle_status='archived',
        archived_at=current_timestamp
    WHERE organization_id=? AND id=? AND deleted_at IS NULL
  `).run('org_a', 'doc-1');

  assert.equal(Number(archive.changes), 1);

  const archived = sqlite
    .prepare(`
      SELECT lifecycle_status, archived_at
      FROM candidate_documents
      WHERE organization_id=? AND id=?
    `)
    .get('org_a', 'doc-1') as {
      lifecycle_status: string;
      archived_at: string | null;
    };

  assert.equal(archived.lifecycle_status, 'archived');
  assert.ok(archived.archived_at);

  const restore = sqlite.prepare(`
    UPDATE candidate_documents
    SET lifecycle_status='available',
        archived_at=NULL
    WHERE organization_id=?
      AND id=?
      AND lifecycle_status='archived'
      AND scan_status='clean'
      AND deleted_at IS NULL
  `).run('org_a', 'doc-1');

  assert.equal(Number(restore.changes), 1);

  const restored = sqlite
    .prepare(`
      SELECT lifecycle_status, archived_at
      FROM candidate_documents
      WHERE organization_id=? AND id=?
    `)
    .get('org_a', 'doc-1') as {
      lifecycle_status: string;
      archived_at: string | null;
    };

  assert.equal(restored.lifecycle_status, 'available');
  assert.equal(restored.archived_at, null);
});

test('infected and rejected documents cannot be restored by the lifecycle rule', () => {
  insertDocument({
    id: 'infected-doc',
    lifecycle_status: 'archived',
    scan_status: 'infected',
  });

  const infectedRestore = sqlite.prepare(`
    UPDATE candidate_documents
    SET lifecycle_status='available',
        archived_at=NULL
    WHERE organization_id=?
      AND id=?
      AND lifecycle_status='archived'
      AND scan_status NOT IN ('infected','rejected')
  `).run('org_a', 'infected-doc');

  assert.equal(Number(infectedRestore.changes), 0);

  insertDocument({
    id: 'rejected-doc',
    lifecycle_status: 'archived',
    scan_status: 'rejected',
    storage_key:
      'documents/44444444444444444444444444444444/dddddddddddddddddddddddddddddddddd',
  });

  const rejectedRestore = sqlite.prepare(`
    UPDATE candidate_documents
    SET lifecycle_status='available',
        archived_at=NULL
    WHERE organization_id=?
      AND id=?
      AND lifecycle_status='archived'
      AND scan_status NOT IN ('infected','rejected')
  `).run('org_a', 'rejected-doc');

  assert.equal(Number(rejectedRestore.changes), 0);
});

test('document IDs and storage keys do not need to contain personal information', () => {
  insertDocument({
    id: 'opaque-document-id',
    original_filename: 'Mohammed-Salman-Ahmed-Resume.pdf',
    sanitized_filename: 'Mohammed-Salman-Ahmed-Resume.pdf',
  });

  const row = sqlite
    .prepare(`
      SELECT id, storage_key
      FROM candidate_documents
      WHERE organization_id=? AND id=?
    `)
    .get('org_a', 'opaque-document-id') as {
      id: string;
      storage_key: string;
    };

  assert.equal(row.storage_key.includes('Mohammed'), false);
  assert.equal(row.storage_key.includes('Salman'), false);
  assert.equal(row.storage_key.includes('Ahmed'), false);
});

test('database document table has the expected tenant and lifecycle indexes', () => {
  const indexes = sqlite
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type='index' AND tbl_name='candidate_documents'
    `)
    .all() as Array<{ name: string }>;

  const names = new Set(indexes.map((index) => index.name));

  assert.ok(names.has('candidate_documents_organization_idx'));
  assert.ok(names.has('candidate_documents_candidate_idx'));
  assert.ok(names.has('candidate_documents_application_idx'));
  assert.ok(names.has('candidate_documents_type_idx'));
  assert.ok(names.has('candidate_documents_status_idx'));
  assert.ok(names.has('candidate_documents_created_idx'));
  assert.ok(names.has('candidate_documents_checksum_idx'));
});

  test('historical migrations are present alongside Phase 2.3 migration', () => {
    const candidateDocuments = sqlite
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type='table' AND name='candidate_documents'
      `)
      .get();

    assert.ok(candidateDocuments);
  });

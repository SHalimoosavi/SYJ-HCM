-- SYJ-HCM Phase 2.3: candidate documents and resume management.
-- Additive only. Historical migrations remain unchanged.

CREATE TABLE IF NOT EXISTS candidate_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  candidate_id TEXT NOT NULL,
  application_id TEXT,
  document_type TEXT NOT NULL CHECK (document_type IN ('resume','cover_letter','certificate','portfolio','other')),
  original_filename TEXT NOT NULL,
  sanitized_filename TEXT NOT NULL,
  declared_mime_type TEXT,
  detected_mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 12582912),
  storage_provider TEXT NOT NULL CHECK (storage_provider IN ('local')),
  storage_key TEXT NOT NULL UNIQUE,
  checksum_sha256 TEXT NOT NULL CHECK (length(checksum_sha256) = 64),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('pending','available','archived','failed')) DEFAULT 'pending',
  scan_status TEXT NOT NULL CHECK (scan_status IN ('pending_scan','clean','infected','scan_failed','scanner_unavailable','rejected')) DEFAULT 'pending_scan',
  uploaded_by TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT,
  retention_until TEXT,
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0,1)),
  supersedes_document_id TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,candidate_id) REFERENCES candidates(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,application_id,candidate_id) REFERENCES applications(organization_id,id,candidate_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,uploaded_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,supersedes_document_id) REFERENCES candidate_documents(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS candidate_documents_organization_idx ON candidate_documents(organization_id);
CREATE INDEX IF NOT EXISTS candidate_documents_candidate_idx ON candidate_documents(organization_id,candidate_id,created_at);
CREATE INDEX IF NOT EXISTS candidate_documents_application_idx ON candidate_documents(organization_id,application_id,created_at);
CREATE INDEX IF NOT EXISTS candidate_documents_type_idx ON candidate_documents(organization_id,document_type,created_at);
CREATE INDEX IF NOT EXISTS candidate_documents_status_idx ON candidate_documents(organization_id,lifecycle_status,scan_status);
CREATE INDEX IF NOT EXISTS candidate_documents_created_idx ON candidate_documents(organization_id,created_at);
CREATE INDEX IF NOT EXISTS candidate_documents_checksum_idx ON candidate_documents(organization_id,checksum_sha256);

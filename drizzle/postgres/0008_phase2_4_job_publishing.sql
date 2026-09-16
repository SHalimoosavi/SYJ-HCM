-- SYJ-HCM Phase 2.4: job publishing, careers portal and public application intake.
-- Additive only. Historical migrations 0000-0007 remain unchanged.

ALTER TABLE organization_settings ADD COLUMN public_careers_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_careers_enabled IN (0,1));

ALTER TABLE applications ADD COLUMN public_cover_letter TEXT;

CREATE TABLE IF NOT EXISTS job_publications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  job_requisition_id TEXT NOT NULL,
  public_slug TEXT NOT NULL,
  public_title TEXT NOT NULL,
  public_description TEXT NOT NULL,
  public_location TEXT,
  employment_type TEXT NOT NULL CHECK (employment_type IN ('full_time','part_time','contract','temporary','internship')),
  workplace_type TEXT NOT NULL CHECK (workplace_type IN ('on_site','hybrid','remote')) DEFAULT 'on_site',
  public_department_name TEXT,
  published_at TEXT,
  closes_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','published','closed','archived')) DEFAULT 'draft',
  application_enabled INTEGER NOT NULL DEFAULT 1 CHECK (application_enabled IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,job_requisition_id),
  FOREIGN KEY (organization_id,job_requisition_id) REFERENCES job_requisitions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS job_publications_public_slug_idx ON job_publications(public_slug);
CREATE INDEX IF NOT EXISTS job_publications_organization_idx ON job_publications(organization_id);
CREATE INDEX IF NOT EXISTS job_publications_status_idx ON job_publications(organization_id,status);
CREATE INDEX IF NOT EXISTS job_publications_published_at_idx ON job_publications(organization_id,published_at);
CREATE INDEX IF NOT EXISTS job_publications_closes_at_idx ON job_publications(organization_id,closes_at);
CREATE INDEX IF NOT EXISTS job_publications_application_enabled_idx ON job_publications(organization_id,application_enabled);

CREATE TABLE IF NOT EXISTS public_application_rate_limits (
  key TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  publication_id TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  window_started_at TEXT NOT NULL,
  last_submitted_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  FOREIGN KEY (organization_id,publication_id) REFERENCES job_publications(organization_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS public_application_rate_limits_organization_idx ON public_application_rate_limits(organization_id,updated_at);
CREATE INDEX IF NOT EXISTS public_application_rate_limits_publication_idx ON public_application_rate_limits(organization_id,publication_id,updated_at);

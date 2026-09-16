-- SYJ-HCM Phase 2.5: offers and offer management.
-- Additive only. Historical migrations 0000-0008 remain unchanged.

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  application_id TEXT NOT NULL,
  offer_reference TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','rejected','approved','sent','accepted','declined','expired','withdrawn','replaced')),
  supersedes_offer_id TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  sent_at TEXT,
  expires_at TEXT,
  responded_at TEXT,
  response_reason TEXT,
  proposed_joining_date TEXT,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (length(trim(currency)) = 3 AND currency = upper(currency)),
  base_salary_minor INTEGER NOT NULL CHECK (base_salary_minor >= 0),
  pay_frequency TEXT NOT NULL DEFAULT 'annual' CHECK (pay_frequency IN ('hourly','weekly','monthly','annual')),
  variable_comp_minor INTEGER NOT NULL DEFAULT 0 CHECK (variable_comp_minor >= 0),
  joining_bonus_minor INTEGER NOT NULL DEFAULT 0 CHECK (joining_bonus_minor >= 0),
  allowances_minor INTEGER NOT NULL DEFAULT 0 CHECK (allowances_minor >= 0),
  other_comp_minor INTEGER NOT NULL DEFAULT 0 CHECK (other_comp_minor >= 0),
  benefits_summary TEXT,
  employment_terms TEXT,
  candidate_response_token_hash TEXT UNIQUE,
  candidate_response_token_expires_at TEXT,
  candidate_response_token_revoked_at TEXT,
  candidate_response_token_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,application_id) REFERENCES applications(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,approved_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,supersedes_offer_id) REFERENCES offers(organization_id,id) ON DELETE RESTRICT,
  CHECK (approved_at IS NULL OR status IN ('approved','sent','accepted','declined','expired','withdrawn','replaced')),
  CHECK (sent_at IS NULL OR status IN ('sent','accepted','declined','expired','withdrawn','replaced')),
  CHECK (responded_at IS NULL OR status IN ('accepted','declined')),
  CHECK (candidate_response_token_hash IS NULL OR length(candidate_response_token_hash) = 64)
);
CREATE INDEX IF NOT EXISTS offers_organization_idx ON offers(organization_id,created_at);
CREATE INDEX IF NOT EXISTS offers_application_idx ON offers(organization_id,application_id,created_at);
CREATE INDEX IF NOT EXISTS offers_status_idx ON offers(organization_id,status,updated_at);
CREATE INDEX IF NOT EXISTS offers_expires_idx ON offers(organization_id,expires_at);
CREATE INDEX IF NOT EXISTS offers_creator_idx ON offers(organization_id,created_by,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS offers_organization_id_idx ON offers(organization_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS offers_organization_id_id_application_idx ON offers(organization_id,id,application_id);
CREATE UNIQUE INDEX IF NOT EXISTS offers_active_application_idx ON offers(organization_id,application_id) WHERE status IN ('draft','pending_approval','approved','sent');

CREATE TABLE IF NOT EXISTS offer_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  offer_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_user_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,offer_id) REFERENCES offers(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS offer_history_offer_idx ON offer_history(organization_id,offer_id,created_at);
CREATE INDEX IF NOT EXISTS offer_history_actor_idx ON offer_history(organization_id,actor_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS offer_history_organization_id_idx ON offer_history(organization_id,id);

CREATE TABLE IF NOT EXISTS offer_response_rate_limits (
  key TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  offer_id TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  window_started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  FOREIGN KEY (organization_id,offer_id) REFERENCES offers(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS offer_response_rate_limits_offer_idx ON offer_response_rate_limits(organization_id,offer_id,updated_at);

ALTER TABLE candidate_documents ADD COLUMN offer_id TEXT;
CREATE INDEX IF NOT EXISTS candidate_documents_offer_idx ON candidate_documents(organization_id,offer_id,created_at);

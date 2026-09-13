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
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
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
  created_at TEXT NOT NULL DEFAULT (current_timestamp),
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
  updated_at TEXT NOT NULL DEFAULT (current_timestamp),
  FOREIGN KEY (organization_id,offer_id) REFERENCES offers(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS offer_response_rate_limits_offer_idx ON offer_response_rate_limits(organization_id,offer_id,updated_at);

ALTER TABLE candidate_documents ADD COLUMN offer_id TEXT;
CREATE INDEX IF NOT EXISTS candidate_documents_offer_idx ON candidate_documents(organization_id,offer_id,created_at);

CREATE TRIGGER IF NOT EXISTS offers_application_tenant_guard_insert
BEFORE INSERT ON offers
WHEN NOT EXISTS (SELECT 1 FROM applications a WHERE a.organization_id=NEW.organization_id AND a.id=NEW.application_id)
BEGIN SELECT RAISE(ABORT,'Offer application does not belong to organization.'); END;
CREATE TRIGGER IF NOT EXISTS offers_application_tenant_guard_update
BEFORE UPDATE OF organization_id,application_id ON offers
WHEN NOT EXISTS (SELECT 1 FROM applications a WHERE a.organization_id=NEW.organization_id AND a.id=NEW.application_id)
BEGIN SELECT RAISE(ABORT,'Offer application does not belong to organization.'); END;

CREATE TRIGGER IF NOT EXISTS offers_no_delete
BEFORE DELETE ON offers BEGIN SELECT RAISE(ABORT,'Offers cannot be hard-deleted.'); END;

CREATE TRIGGER IF NOT EXISTS offers_status_guard
BEFORE UPDATE OF status ON offers
WHEN NOT (
 (OLD.status='draft' AND NEW.status IN ('pending_approval','replaced')) OR
 (OLD.status='pending_approval' AND NEW.status IN ('approved','rejected','replaced')) OR
 (OLD.status='rejected' AND NEW.status='replaced') OR
 (OLD.status='withdrawn' AND NEW.status='replaced') OR
 (OLD.status='approved' AND NEW.status IN ('sent','withdrawn','replaced')) OR
 (OLD.status='sent' AND NEW.status IN ('accepted','declined','expired','withdrawn','replaced')) OR
 (OLD.status IN ('rejected','accepted','declined','expired','withdrawn','replaced') AND NEW.status=OLD.status)
)
BEGIN SELECT RAISE(ABORT,'Invalid offer status transition.'); END;

CREATE TRIGGER IF NOT EXISTS offers_identity_immutable
BEFORE UPDATE OF organization_id,application_id,offer_reference,version,created_by,created_at,supersedes_offer_id ON offers
BEGIN SELECT RAISE(ABORT,'Offer identity is immutable.'); END;

CREATE TRIGGER IF NOT EXISTS offers_approved_terms_immutable
BEFORE UPDATE OF currency,base_salary_minor,pay_frequency,variable_comp_minor,joining_bonus_minor,allowances_minor,other_comp_minor,benefits_summary,employment_terms,proposed_joining_date,expires_at
ON offers
WHEN OLD.status IN ('approved','sent','accepted','declined','expired','withdrawn','replaced')
BEGIN SELECT RAISE(ABORT,'Approved offer terms are immutable; create a revision.'); END;

CREATE TRIGGER IF NOT EXISTS offers_approved_metadata_guard
BEFORE UPDATE OF approved_by,approved_at,rejection_reason,sent_at,responded_at,response_reason,candidate_response_token_hash,candidate_response_token_expires_at,candidate_response_token_revoked_at,candidate_response_token_used_at
ON offers
WHEN OLD.status IN ('accepted','declined','expired','withdrawn','replaced')
BEGIN SELECT RAISE(ABORT,'Terminal offer records are immutable.'); END;

CREATE TRIGGER IF NOT EXISTS offer_history_immutable_update
BEFORE UPDATE ON offer_history BEGIN SELECT RAISE(ABORT,'Offer history is immutable.'); END;
CREATE TRIGGER IF NOT EXISTS offer_history_immutable_delete
BEFORE DELETE ON offer_history BEGIN SELECT RAISE(ABORT,'Offer history is immutable.'); END;

CREATE TRIGGER IF NOT EXISTS offer_response_rate_limit_nonnegative
BEFORE UPDATE OF request_count ON offer_response_rate_limits
WHEN NEW.request_count < 0
BEGIN SELECT RAISE(ABORT,'Invalid offer response rate limit.'); END;

CREATE TRIGGER IF NOT EXISTS candidate_documents_offer_guard_insert
BEFORE INSERT ON candidate_documents
WHEN NEW.offer_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM offers o JOIN applications a ON a.organization_id=o.organization_id AND a.id=o.application_id
 WHERE o.organization_id=NEW.organization_id AND o.id=NEW.offer_id AND a.id=NEW.application_id AND a.candidate_id=NEW.candidate_id
)
BEGIN SELECT RAISE(ABORT,'Offer document ownership does not match application and candidate.'); END;
CREATE TRIGGER IF NOT EXISTS candidate_documents_offer_guard_update
BEFORE UPDATE OF organization_id,candidate_id,application_id,offer_id ON candidate_documents
WHEN NEW.offer_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM offers o JOIN applications a ON a.organization_id=o.organization_id AND a.id=o.application_id
 WHERE o.organization_id=NEW.organization_id AND o.id=NEW.offer_id AND a.id=NEW.application_id AND a.candidate_id=NEW.candidate_id
)
BEGIN SELECT RAISE(ABORT,'Offer document ownership does not match application and candidate.'); END;

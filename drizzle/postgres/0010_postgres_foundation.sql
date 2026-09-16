-- SYJ-HCM PostgreSQL foundation: native types, integrity triggers, RLS and
-- narrow pre-tenant bootstrap functions. Historical SQLite migrations 0000-0009
-- remain immutable; this file is the PostgreSQL-only hardening layer.

-- ---------------------------------------------------------------------------
-- Native PostgreSQL booleans
-- ---------------------------------------------------------------------------
-- Historical PostgreSQL migrations preserve SQLite-style INTEGER booleans
-- (0/1). Drop those legacy integer CHECK constraints before changing the
-- column types to native PostgreSQL boolean.

ALTER TABLE candidate_documents
  DROP CONSTRAINT IF EXISTS candidate_documents_legal_hold_check;

ALTER TABLE job_publications
  DROP CONSTRAINT IF EXISTS job_publications_application_enabled_check;

ALTER TABLE organization_settings
  DROP CONSTRAINT IF EXISTS organization_settings_public_careers_enabled_check;

ALTER TABLE recruitment_stages
  DROP CONSTRAINT IF EXISTS recruitment_stages_is_active_check;

ALTER TABLE users ALTER COLUMN is_active DROP DEFAULT;
ALTER TABLE users ALTER COLUMN is_active TYPE boolean USING (is_active <> 0);
ALTER TABLE users ALTER COLUMN is_active SET DEFAULT true;

ALTER TABLE organization_settings ALTER COLUMN public_careers_enabled DROP DEFAULT;
ALTER TABLE organization_settings ALTER COLUMN public_careers_enabled TYPE boolean USING (public_careers_enabled <> 0);
ALTER TABLE organization_settings ALTER COLUMN public_careers_enabled SET DEFAULT false;

ALTER TABLE leave_types ALTER COLUMN is_paid DROP DEFAULT;
ALTER TABLE leave_types ALTER COLUMN is_paid TYPE boolean USING (is_paid <> 0);
ALTER TABLE leave_types ALTER COLUMN is_paid SET DEFAULT true;

ALTER TABLE recruitment_stages ALTER COLUMN is_active DROP DEFAULT;
ALTER TABLE recruitment_stages ALTER COLUMN is_active TYPE boolean USING (is_active <> 0);
ALTER TABLE recruitment_stages ALTER COLUMN is_active SET DEFAULT true;

ALTER TABLE job_publications ALTER COLUMN application_enabled DROP DEFAULT;
ALTER TABLE job_publications ALTER COLUMN application_enabled TYPE boolean USING (application_enabled <> 0);
ALTER TABLE job_publications ALTER COLUMN application_enabled SET DEFAULT true;

ALTER TABLE candidate_documents ALTER COLUMN legal_hold DROP DEFAULT;
ALTER TABLE candidate_documents ALTER COLUMN legal_hold TYPE boolean USING (legal_hold <> 0);
ALTER TABLE candidate_documents ALTER COLUMN legal_hold SET DEFAULT false;

-- ---------------------------------------------------------------------------
-- Native timezone-aware timestamps. Existing ISO/text values are converted
-- explicitly; blank values become NULL rather than being implicitly cast.
-- ---------------------------------------------------------------------------


-- The historical interviews CHECK compares two TEXT columns. It must be
-- removed before either column changes type and recreated afterward.
ALTER TABLE public.interviews
  DROP CONSTRAINT IF EXISTS interviews_check;
DO $$
DECLARE
  r record;
  timestamp_columns constant text[] := ARRAY[
    'created_at','updated_at','expires_at','last_active_at','window_started_at',
    'locked_until','applied_at','approved_at','sent_at','responded_at',
    'published_at','closes_at','last_submitted_at',
    'candidate_response_token_expires_at','candidate_response_token_revoked_at',
    'candidate_response_token_used_at','archived_at','deleted_at','retention_until',
    'clock_in_at','clock_out_at','scheduled_start','scheduled_end','submitted_at'
  ];
BEGIN
  FOR r IN
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'text'
      AND column_name = ANY(timestamp_columns)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT', r.table_schema, r.table_name, r.column_name);
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE timestamptz USING NULLIF(trim(%I), '''')::timestamptz',
      r.table_schema, r.table_name, r.column_name, r.column_name
    );
  END LOOP;
END $$;

-- Recreate the historical interview scheduling integrity rule now that both
-- columns are native timestamptz.
ALTER TABLE public.interviews
  ADD CONSTRAINT interviews_check
  CHECK (scheduled_end > scheduled_start);

-- Restore defaults for timestamp columns that had current_timestamp defaults.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','organization_settings','departments','users','sessions',
    'login_rate_limits','platform_administrators','platform_audit_logs','employees',
    'job_requisitions','candidates','applications','application_history',
    'recruitment_stages','interview_rounds','interviews','interview_participants',
    'interview_feedback','interview_feedback_corrections','interview_decisions',
    'candidate_notes','candidate_activities','leave_types','leave_balances',
    'leave_requests','attendance_records','audit_logs','job_publications',
    'public_application_rate_limits','offers','offer_history',
    'offer_response_rate_limits','candidate_documents'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='created_at') THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_at SET DEFAULT now()', t);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='updated_at') THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN updated_at SET DEFAULT now()', t);
    END IF;
  END LOOP;
  ALTER TABLE sessions ALTER COLUMN last_active_at SET DEFAULT now();
END $$;

-- ---------------------------------------------------------------------------
-- Integrity trigger functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION syj_immutable_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%', TG_ARGV[0] USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION syj_attendance_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.clock_in_lat IS NOT NULL AND (NEW.clock_in_lat < -90 OR NEW.clock_in_lat > 90))
     OR (NEW.clock_in_lng IS NOT NULL AND (NEW.clock_in_lng < -180 OR NEW.clock_in_lng > 180))
     OR (NEW.clock_out_lat IS NOT NULL AND (NEW.clock_out_lat < -90 OR NEW.clock_out_lat > 90))
     OR (NEW.clock_out_lng IS NOT NULL AND (NEW.clock_out_lng < -180 OR NEW.clock_out_lng > 180))
     OR ((NEW.clock_in_lat IS NULL) <> (NEW.clock_in_lng IS NULL))
     OR ((NEW.clock_out_lat IS NULL) <> (NEW.clock_out_lng IS NULL)) THEN
    RAISE EXCEPTION 'Invalid attendance coordinates';
  END IF;
  IF NEW.clock_out_at IS NOT NULL AND NEW.clock_in_at IS NULL THEN
    RAISE EXCEPTION 'Clock-out requires clock-in';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_leave_request_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('approved','rejected','cancelled'))
    OR OLD.status = NEW.status
  ) THEN
    RAISE EXCEPTION 'Invalid leave request state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_candidate_document_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.application_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM applications a
    WHERE a.organization_id = NEW.organization_id
      AND a.id = NEW.application_id
      AND a.candidate_id = NEW.candidate_id
  ) THEN
    RAISE EXCEPTION 'Document application does not belong to candidate.';
  END IF;
  IF NEW.lifecycle_status = 'available' AND NEW.scan_status <> 'clean' THEN
    RAISE EXCEPTION 'Available document requires a clean malware scan.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_job_publication_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published' AND (
    NEW.public_title = '' OR length(NEW.public_title) > 200
    OR NEW.public_description = '' OR length(NEW.public_description) > 50000
    OR NEW.public_slug = '' OR NEW.public_slug !~ '^[a-z0-9].*$'
    OR NEW.application_enabled IS NULL
  ) THEN
    RAISE EXCEPTION 'Job publication is not valid for publishing.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_offer_application_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM applications a
    WHERE a.organization_id = NEW.organization_id AND a.id = NEW.application_id
  ) THEN
    RAISE EXCEPTION 'Offer application does not belong to organization.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_offer_status_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    (OLD.status='draft' AND NEW.status IN ('pending_approval','replaced')) OR
    (OLD.status='pending_approval' AND NEW.status IN ('approved','rejected','replaced')) OR
    (OLD.status='rejected' AND NEW.status='replaced') OR
    (OLD.status='withdrawn' AND NEW.status='replaced') OR
    (OLD.status='approved' AND NEW.status IN ('sent','withdrawn','replaced')) OR
    (OLD.status='sent' AND NEW.status IN ('accepted','declined','expired','withdrawn','replaced')) OR
    (OLD.status IN ('rejected','accepted','declined','expired','withdrawn','replaced') AND NEW.status=OLD.status)
  ) THEN
    RAISE EXCEPTION 'Invalid offer status transition.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_offer_terms_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('approved','sent','accepted','declined','expired','withdrawn','replaced') AND
     (NEW.currency IS DISTINCT FROM OLD.currency OR NEW.base_salary_minor IS DISTINCT FROM OLD.base_salary_minor
      OR NEW.pay_frequency IS DISTINCT FROM OLD.pay_frequency OR NEW.variable_comp_minor IS DISTINCT FROM OLD.variable_comp_minor
      OR NEW.joining_bonus_minor IS DISTINCT FROM OLD.joining_bonus_minor OR NEW.allowances_minor IS DISTINCT FROM OLD.allowances_minor
      OR NEW.other_comp_minor IS DISTINCT FROM OLD.other_comp_minor OR NEW.benefits_summary IS DISTINCT FROM OLD.benefits_summary
      OR NEW.employment_terms IS DISTINCT FROM OLD.employment_terms OR NEW.proposed_joining_date IS DISTINCT FROM OLD.proposed_joining_date
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN
    RAISE EXCEPTION 'Approved offer terms are immutable; create a revision.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_offer_terminal_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('accepted','declined','expired','withdrawn','replaced') AND
     (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
      OR NEW.responded_at IS DISTINCT FROM OLD.responded_at OR NEW.response_reason IS DISTINCT FROM OLD.response_reason
      OR NEW.candidate_response_token_hash IS DISTINCT FROM OLD.candidate_response_token_hash
      OR NEW.candidate_response_token_expires_at IS DISTINCT FROM OLD.candidate_response_token_expires_at
      OR NEW.candidate_response_token_revoked_at IS DISTINCT FROM OLD.candidate_response_token_revoked_at
      OR NEW.candidate_response_token_used_at IS DISTINCT FROM OLD.candidate_response_token_used_at) THEN
    RAISE EXCEPTION 'Terminal offer records are immutable.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_offer_response_rate_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.request_count < 0 THEN RAISE EXCEPTION 'Invalid offer response rate limit.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION syj_offer_document_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.offer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM offers o
    JOIN applications a ON a.organization_id=o.organization_id AND a.id=o.application_id
    WHERE o.organization_id=NEW.organization_id
      AND o.id=NEW.offer_id
      AND a.id=NEW.application_id
      AND a.candidate_id=NEW.candidate_id
  ) THEN
    RAISE EXCEPTION 'Offer document ownership does not match application and candidate.';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Recreate integrity triggers in PostgreSQL.
-- ---------------------------------------------------------------------------

CREATE TRIGGER attendance_coordinates_insert_guard BEFORE INSERT ON attendance_records EXECUTE FUNCTION syj_attendance_guard();
CREATE TRIGGER attendance_coordinates_update_guard BEFORE UPDATE OF clock_in_lat,clock_in_lng,clock_out_lat,clock_out_lng ON attendance_records EXECUTE FUNCTION syj_attendance_guard();
CREATE TRIGGER attendance_clock_order_guard BEFORE UPDATE OF clock_in_at,clock_out_at ON attendance_records EXECUTE FUNCTION syj_attendance_guard();
CREATE TRIGGER attendance_clock_order_insert_guard BEFORE INSERT ON attendance_records EXECUTE FUNCTION syj_attendance_guard();
CREATE TRIGGER leave_request_transition_guard BEFORE UPDATE OF status ON leave_requests EXECUTE FUNCTION syj_leave_request_transition_guard();
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs EXECUTE FUNCTION syj_immutable_row('Audit logs are immutable');
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs EXECUTE FUNCTION syj_immutable_row('Audit logs are immutable');
CREATE TRIGGER platform_audit_logs_no_update BEFORE UPDATE ON platform_audit_logs EXECUTE FUNCTION syj_immutable_row('Platform audit logs are immutable');
CREATE TRIGGER platform_audit_logs_no_delete BEFORE DELETE ON platform_audit_logs EXECUTE FUNCTION syj_immutable_row('Platform audit logs are immutable');
CREATE TRIGGER application_history_immutable_update BEFORE UPDATE ON application_history EXECUTE FUNCTION syj_immutable_row('Application history is immutable.');
CREATE TRIGGER application_history_immutable_delete BEFORE DELETE ON application_history EXECUTE FUNCTION syj_immutable_row('Application history is immutable.');
CREATE TRIGGER interview_decisions_immutable_update BEFORE UPDATE ON interview_decisions EXECUTE FUNCTION syj_immutable_row('Interview decisions are immutable.');
CREATE TRIGGER interview_decisions_immutable_delete BEFORE DELETE ON interview_decisions EXECUTE FUNCTION syj_immutable_row('Interview decisions are immutable.');
CREATE TRIGGER interview_feedback_immutable_update BEFORE UPDATE ON interview_feedback EXECUTE FUNCTION syj_immutable_row('Interview feedback is immutable; use a correction record.');
CREATE TRIGGER interview_feedback_immutable_delete BEFORE DELETE ON interview_feedback EXECUTE FUNCTION syj_immutable_row('Interview feedback is immutable.');
CREATE TRIGGER interview_feedback_corrections_immutable_update BEFORE UPDATE ON interview_feedback_corrections EXECUTE FUNCTION syj_immutable_row('Feedback corrections are immutable.');
CREATE TRIGGER interview_feedback_corrections_immutable_delete BEFORE DELETE ON interview_feedback_corrections EXECUTE FUNCTION syj_immutable_row('Feedback corrections are immutable.');
CREATE TRIGGER candidate_activities_immutable_update BEFORE UPDATE ON candidate_activities EXECUTE FUNCTION syj_immutable_row('Candidate activities are immutable.');
CREATE TRIGGER candidate_activities_immutable_delete BEFORE DELETE ON candidate_activities EXECUTE FUNCTION syj_immutable_row('Candidate activities are immutable.');
CREATE TRIGGER candidate_documents_application_candidate_guard_insert BEFORE INSERT ON candidate_documents EXECUTE FUNCTION syj_candidate_document_guard();
CREATE TRIGGER candidate_documents_application_candidate_guard_update BEFORE UPDATE OF organization_id,candidate_id,application_id ON candidate_documents EXECUTE FUNCTION syj_candidate_document_guard();
CREATE TRIGGER candidate_documents_immutable_identity BEFORE UPDATE OF organization_id,candidate_id,application_id,document_type,storage_key,checksum_sha256,uploaded_by,created_at ON candidate_documents EXECUTE FUNCTION syj_immutable_row('Document identity is immutable.');
CREATE TRIGGER candidate_documents_available_requires_clean_insert BEFORE INSERT ON candidate_documents EXECUTE FUNCTION syj_candidate_document_guard();
CREATE TRIGGER candidate_documents_available_requires_clean_update BEFORE UPDATE OF lifecycle_status,scan_status ON candidate_documents EXECUTE FUNCTION syj_candidate_document_guard();
CREATE TRIGGER job_publications_immutable_identity BEFORE UPDATE OF organization_id,job_requisition_id,id,created_by,created_at ON job_publications EXECUTE FUNCTION syj_immutable_row('Job publication identity is immutable.');
CREATE TRIGGER job_publications_publish_guard BEFORE UPDATE OF status ON job_publications EXECUTE FUNCTION syj_job_publication_guard();
CREATE TRIGGER offers_application_tenant_guard_insert BEFORE INSERT ON offers EXECUTE FUNCTION syj_offer_application_guard();
CREATE TRIGGER offers_application_tenant_guard_update BEFORE UPDATE OF organization_id,application_id ON offers EXECUTE FUNCTION syj_offer_application_guard();
CREATE TRIGGER offers_no_delete BEFORE DELETE ON offers EXECUTE FUNCTION syj_immutable_row('Offers cannot be hard-deleted.');
CREATE TRIGGER offers_status_guard BEFORE UPDATE OF status ON offers EXECUTE FUNCTION syj_offer_status_guard();
CREATE TRIGGER offers_identity_immutable BEFORE UPDATE OF organization_id,application_id,offer_reference,version,created_by,created_at,supersedes_offer_id ON offers EXECUTE FUNCTION syj_immutable_row('Offer identity is immutable.');
CREATE TRIGGER offers_approved_terms_immutable BEFORE UPDATE OF currency,base_salary_minor,pay_frequency,variable_comp_minor,joining_bonus_minor,allowances_minor,other_comp_minor,benefits_summary,employment_terms,proposed_joining_date,expires_at ON offers EXECUTE FUNCTION syj_offer_terms_guard();
CREATE TRIGGER offers_approved_metadata_guard BEFORE UPDATE OF approved_by,approved_at,rejection_reason,sent_at,responded_at,response_reason,candidate_response_token_hash,candidate_response_token_expires_at,candidate_response_token_revoked_at,candidate_response_token_used_at ON offers EXECUTE FUNCTION syj_offer_terminal_guard();
CREATE TRIGGER offer_history_immutable_update BEFORE UPDATE ON offer_history EXECUTE FUNCTION syj_immutable_row('Offer history is immutable.');
CREATE TRIGGER offer_history_immutable_delete BEFORE DELETE ON offer_history EXECUTE FUNCTION syj_immutable_row('Offer history is immutable.');
CREATE TRIGGER offer_response_rate_limit_nonnegative BEFORE UPDATE OF request_count ON offer_response_rate_limits EXECUTE FUNCTION syj_offer_response_rate_guard();
CREATE TRIGGER candidate_documents_offer_guard_insert BEFORE INSERT ON candidate_documents EXECUTE FUNCTION syj_offer_document_guard();
CREATE TRIGGER candidate_documents_offer_guard_update BEFORE UPDATE OF organization_id,candidate_id,application_id,offer_id ON candidate_documents EXECUTE FUNCTION syj_offer_document_guard();

-- ---------------------------------------------------------------------------
-- Narrow bootstrap functions. They are owned by the migration/schema owner.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION resolve_session(p_session_id text)
RETURNS TABLE(organization_id text, user_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT s.organization_id, s.user_id
  FROM public.sessions AS s
  WHERE s.id = p_session_id
  LIMIT 1;
END;
$$;


CREATE OR REPLACE FUNCTION resolve_login_user(p_email text)
RETURNS TABLE(
  user_id text,
  organization_id text,
  email text,
  password_hash text,
  password_salt text,
  role text,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.organization_id, u.email, u.password_hash, u.password_salt, u.role, u.is_active
  FROM public.users AS u
  WHERE u.email = p_email
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION resolve_login_user(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION resolve_job_publication(p_slug text)
RETURNS TABLE(
  organization_id text,
  publication_id text,
  public_slug text,
  public_title text,
  public_description text,
  public_location text,
  employment_type text,
  workplace_type text,
  public_department_name text,
  published_at timestamptz,
  closes_at timestamptz,
  application_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT jp.organization_id, jp.id, jp.public_slug, jp.public_title, jp.public_description,
         jp.public_location, jp.employment_type, jp.workplace_type, jp.public_department_name,
         jp.published_at, jp.closes_at, jp.application_enabled
  FROM public.job_publications AS jp
  JOIN public.organizations AS o ON o.id = jp.organization_id
  JOIN public.organization_settings AS os ON os.organization_id = jp.organization_id
  JOIN public.job_requisitions AS jr ON jr.organization_id = jp.organization_id AND jr.id = jp.job_requisition_id
  WHERE jp.public_slug = p_slug
    AND jp.status = 'published'
    AND o.status = 'active'
    AND os.public_careers_enabled = true
    AND (jp.closes_at IS NULL OR jp.closes_at > now())
    AND jr.status = 'open'
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION resolve_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_job_publication(text) FROM PUBLIC;

-- The deployment-specific runtime role receives only these three bootstrap
-- entry points. DATABASE_MIGRATION_URL should own the schema/functions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_setting('app.runtime_role', true)) THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION resolve_session(text) TO %I', current_setting('app.runtime_role'));
    EXECUTE format('GRANT EXECUTE ON FUNCTION resolve_login_user(text) TO %I', current_setting('app.runtime_role'));
    EXECUTE format('GRANT EXECUTE ON FUNCTION resolve_job_publication(text) TO %I', current_setting('app.runtime_role'));
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Runtime role gets ordinary DML privileges; RLS determines which tenant rows are visible.

DO $$
DECLARE
  t text;
  runtime_role text := current_setting('app.runtime_role', true);
BEGIN
  IF runtime_role IS NOT NULL AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_role);
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '__migrations' LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', t, runtime_role);
    END LOOP;
    EXECUTE format('GRANT SELECT ON TABLE public.__migrations TO %I', runtime_role);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS: private tenant-owned data is default-deny without app.current_org_id.
-- ---------------------------------------------------------------------------


DO $$
DECLARE
  t text;
  tenant_tables constant text[] := ARRAY[
    'organization_settings','departments','users','employees','job_requisitions',
    'candidates','applications','application_history','recruitment_stages',
    'interview_rounds','interviews','interview_participants','interview_feedback',
    'interview_feedback_corrections','interview_decisions','candidate_notes',
    'candidate_activities','leave_types','leave_balances','leave_requests',
    'attendance_records','audit_logs','offers','offer_history','offer_response_rate_limits','candidate_documents'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_select ON public.%I FOR SELECT USING (organization_id = current_setting(''app.current_org_id'', true))', t, t);
    EXECUTE format('CREATE POLICY %I_insert ON public.%I FOR INSERT WITH CHECK (organization_id = current_setting(''app.current_org_id'', true))', t, t);
    EXECUTE format('CREATE POLICY %I_update ON public.%I FOR UPDATE USING (organization_id = current_setting(''app.current_org_id'', true)) WITH CHECK (organization_id = current_setting(''app.current_org_id'', true))', t, t);
    EXECUTE format('CREATE POLICY %I_delete ON public.%I FOR DELETE USING (organization_id = current_setting(''app.current_org_id'', true))', t, t);
  END LOOP;
END $$;

-- Published job posts are intentionally public. Writes remain tenant-scoped.
ALTER TABLE public.job_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_publications_public_select ON public.job_publications
  FOR SELECT
  USING (
    status = 'published'
    AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = job_publications.organization_id AND o.status = 'active')
  );
CREATE POLICY job_publications_tenant_insert ON public.job_publications
  FOR INSERT
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));
CREATE POLICY job_publications_tenant_update ON public.job_publications
  FOR UPDATE
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));
CREATE POLICY job_publications_tenant_delete ON public.job_publications
  FOR DELETE
  USING (organization_id = current_setting('app.current_org_id', true));

-- Explicitly exempt exact-key rate-limit/session tables from strict RLS. Their
-- access is controlled by the application and/or bootstrap token boundaries.
COMMENT ON TABLE sessions IS 'RLS intentionally not enabled: exact session-token bootstrap uses resolve_session().';
COMMENT ON TABLE login_rate_limits IS 'RLS intentionally not enabled: exact HMAC-derived key access only; application controls tenant context.';
COMMENT ON TABLE public_application_rate_limits IS 'RLS intentionally not enabled: exact HMAC-derived key access only; application controls tenant context.';
COMMENT ON TABLE organizations IS 'Global tenant root; not tenant-owned and therefore not subject to app.current_org_id RLS.';
COMMENT ON TABLE platform_administrators IS 'Platform-wide system table; authorization is application/platform-role based.';
COMMENT ON TABLE platform_audit_logs IS 'Platform-wide audit table; not tenant-owned.';

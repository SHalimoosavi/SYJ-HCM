-- Public recruitment bootstrap remains a narrow anonymous lookup. It now returns
-- only the minimum organization/job metadata required by the public application
-- flow, avoiding RLS-protected tenant-table reads after bootstrap.

DROP FUNCTION IF EXISTS public.resolve_job_publication(text);

CREATE FUNCTION public.resolve_job_publication(p_slug text)
RETURNS TABLE(
  organization_id text,
  organization_name text,
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
  application_enabled boolean,
  job_requisition_id text,
  job_created_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jp.organization_id,
    o.name,
    jp.id,
    jp.public_slug,
    jp.public_title,
    jp.public_description,
    jp.public_location,
    jp.employment_type,
    jp.workplace_type,
    jp.public_department_name,
    jp.published_at,
    jp.closes_at,
    jp.application_enabled,
    jp.job_requisition_id,
    jr.created_by
  FROM public.job_publications AS jp
  JOIN public.organizations AS o
    ON o.id = jp.organization_id
  JOIN public.organization_settings AS os
    ON os.organization_id = jp.organization_id
  JOIN public.job_requisitions AS jr
    ON jr.organization_id = jp.organization_id
   AND jr.id = jp.job_requisition_id
  WHERE jp.public_slug = p_slug
    AND jp.status = 'published'
    AND o.status = 'active'
    AND os.public_careers_enabled = true
    AND (jp.closes_at IS NULL OR jp.closes_at > now())
    AND jr.status = 'open'
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_job_publication(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_setting('app.runtime_role', true)) THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.resolve_job_publication(text) TO %I', current_setting('app.runtime_role', true));
  END IF;
END $$;

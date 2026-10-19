-- Restore business timestamp defaults that were present in the historical
-- recruitment schema but were lost when 0010 converted text timestamps to
-- native timestamptz and rebuilt defaults generically.
--
-- These defaults are required for application inserts that intentionally omit
-- server-generated lifecycle timestamps.

ALTER TABLE public.applications
  ALTER COLUMN applied_at SET DEFAULT now();

ALTER TABLE public.interview_feedback
  ALTER COLUMN submitted_at SET DEFAULT now();

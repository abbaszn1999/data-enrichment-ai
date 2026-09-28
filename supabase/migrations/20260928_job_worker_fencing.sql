-- Background job hardening.
--
-- 1. worker_token: every orchestrator that starts (or resumes) a run writes a
--    fresh token. A worker whose token no longer matches has been superseded
--    (e.g. a resume after a stale heartbeat) and must stop without touching the
--    run, so two workers never process or finalize the same job.
--
-- 2. verify_jobs_cron_secret: /api/jobs/sweep previously required the cron
--    secret as an app env var; when that var was missing every pg_cron call
--    returned 503 and stale jobs were never recovered. The app can now verify
--    the presented bearer against the same Vault secret pg_cron sends, without
--    ever reading the secret itself. service_role only.

ALTER TABLE public.job_runs ADD COLUMN IF NOT EXISTS worker_token text;

CREATE OR REPLACE FUNCTION public.verify_jobs_cron_secret(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  IF p_secret IS NULL OR length(p_secret) = 0 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name IN ('jobs_cron_secret', 'growth_sync_cron_secret')
      AND decrypted_secret = p_secret
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_jobs_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_jobs_cron_secret(text) TO service_role;

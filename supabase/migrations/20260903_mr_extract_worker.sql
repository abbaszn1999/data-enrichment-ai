-- Market Research keyword extract continues on the server after the browser
-- closes: job_runs kind + stored dataset cursors + a short pump lease so the
-- client poll and the worker cannot advance the same Apify offset twice.

DO $$
DECLARE
  conname text;
BEGIN
  SELECT c.conname INTO conname
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'job_runs'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%gallery%visualizer%'
    AND pg_get_constraintdef(c.oid) NOT LIKE '%mr_extract%';
  IF conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.job_runs DROP CONSTRAINT %I', conname);
  END IF;
END $$;

ALTER TABLE public.job_runs
  DROP CONSTRAINT IF EXISTS job_runs_kind_check;

ALTER TABLE public.job_runs
  ADD CONSTRAINT job_runs_kind_check
  CHECK (kind IN ('catalog', 'gallery', 'visualizer', 'mr_extract'));

ALTER TABLE public.mr_runs
  ADD COLUMN IF NOT EXISTS next_cursor TEXT;

ALTER TABLE public.mr_extracts
  ADD COLUMN IF NOT EXISTS pump_lease_until TIMESTAMPTZ;

ALTER TABLE public.mr_extracts
  ADD COLUMN IF NOT EXISTS job_run_id UUID REFERENCES public.job_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS mr_extracts_job_run_idx
  ON public.mr_extracts (job_run_id)
  WHERE job_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mr_extracts_held_running_idx
  ON public.mr_extracts (workspace_id, project_id, created_at DESC)
  WHERE billing_status = 'held' AND status = 'running';

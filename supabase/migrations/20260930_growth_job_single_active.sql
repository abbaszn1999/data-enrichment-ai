-- One active (queued/running) Growth Engine / Free Assessment job per project
-- and kind, so two quick Start clicks can never launch two paid runs.
-- Extract jobs are keyed by their own extract row and are not included.

-- Close older duplicates first; the newest active run for each project is kept.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY workspace_id, kind, session_id
      ORDER BY created_at DESC
    ) AS rn
  FROM public.job_runs
  WHERE status IN ('queued', 'running')
    AND kind IN ('mr_stage1', 'fa_stage1', 'mr_classify', 'fa_classify', 'mr_collections')
)
UPDATE public.job_runs r
SET
  status = 'cancelled',
  last_error = 'Superseded by a newer run of the same step',
  updated_at = now()
FROM ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS job_runs_one_active_per_session
  ON public.job_runs (workspace_id, kind, session_id)
  WHERE status IN ('queued', 'running')
    AND kind IN ('mr_stage1', 'fa_stage1', 'mr_classify', 'fa_classify', 'mr_collections');

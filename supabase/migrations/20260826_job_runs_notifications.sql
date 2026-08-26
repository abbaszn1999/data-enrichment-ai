-- Background job runs (Catalog Intelligence, Gallery, Visualizer) plus
-- in-app notifications written when a run reaches a terminal state.

CREATE TABLE IF NOT EXISTS public.job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('catalog', 'gallery', 'visualizer')),
  session_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled',
      'paused_no_credits'
    )),
  target_ids TEXT[] NOT NULL DEFAULT '{}',
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  heartbeat_at TIMESTAMPTZ,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  task_run_id TEXT,
  last_error TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_runs_workspace_created_idx
  ON public.job_runs (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_runs_workspace_user_status_idx
  ON public.job_runs (workspace_id, created_by, status);

CREATE INDEX IF NOT EXISTS job_runs_session_idx
  ON public.job_runs (kind, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_runs_stale_idx
  ON public.job_runs (heartbeat_at)
  WHERE status = 'running';

ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_runs_select_member ON public.job_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = job_runs.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.job_runs FROM anon, authenticated;
GRANT SELECT ON public.job_runs TO authenticated;
GRANT ALL ON public.job_runs TO service_role;

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_run_id UUID NOT NULL REFERENCES public.job_runs(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('completed', 'failed', 'paused_no_credits')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '/',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_job_run_event_idx
  ON public.notifications (job_run_id, event);

CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON public.notifications (workspace_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (workspace_id, user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = notifications.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

CREATE OR REPLACE FUNCTION public.claim_stale_job_runs(
  p_stale_minutes integer DEFAULT 10,
  p_limit integer DEFAULT 5
)
RETURNS SETOF public.job_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT r.id
    FROM public.job_runs r
    WHERE r.status = 'running'
      AND r.cancel_requested = false
      AND (
        r.heartbeat_at IS NULL
        OR r.heartbeat_at <= now() - make_interval(mins => GREATEST(COALESCE(p_stale_minutes, 10), 1))
      )
    ORDER BY r.heartbeat_at NULLS FIRST
    LIMIT GREATEST(COALESCE(p_limit, 5), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.job_runs r
  SET
    heartbeat_at = now(),
    updated_at = now()
  FROM stale
  WHERE r.id = stale.id
  RETURNING r.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_job_run(
  p_id uuid,
  p_workspace_id uuid
)
RETURNS public.job_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.job_runs;
BEGIN
  UPDATE public.job_runs
  SET
    cancel_requested = true,
    updated_at = now()
  WHERE id = p_id
    AND workspace_id = p_workspace_id
    AND status IN ('queued', 'running')
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stale_job_runs(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stale_job_runs(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_job_run(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_job_run(uuid, uuid) TO service_role;

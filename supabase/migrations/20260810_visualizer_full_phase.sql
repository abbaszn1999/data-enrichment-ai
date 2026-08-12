-- Allow a single Generate run to cover description + images (phase = full).

ALTER TABLE public.visualizer_sessions
  DROP CONSTRAINT IF EXISTS visualizer_sessions_active_phase_check;

ALTER TABLE public.visualizer_sessions
  ADD CONSTRAINT visualizer_sessions_active_phase_check
  CHECK (
    active_phase IS NULL
    OR active_phase IN ('description', 'images', 'full')
  );

CREATE OR REPLACE FUNCTION public.claim_visualizer_session_run(
  p_session_id uuid,
  p_workspace_id uuid,
  p_phase text DEFAULT 'description'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  IF p_phase IS NULL OR p_phase NOT IN ('description', 'images', 'full') THEN
    RETURN false;
  END IF;

  UPDATE public.visualizer_sessions
  SET
    status = 'processing',
    active_phase = p_phase,
    awaiting_user_action = false,
    cancel_requested = false,
    error_message = NULL,
    updated_at = NOW()
  WHERE id = p_session_id
    AND workspace_id = p_workspace_id
    AND (
      status <> 'processing'
      OR updated_at < NOW() - INTERVAL '10 minutes'
    )
  RETURNING id INTO claimed_id;

  RETURN claimed_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_visualizer_session_usage(
  p_session_id uuid,
  p_workspace_id uuid,
  p_credits numeric,
  p_cost numeric,
  p_ready_rows integer,
  p_failed_rows integer,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_awaiting_user_action boolean DEFAULT false,
  p_active_phase text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_id uuid;
BEGIN
  IF p_credits < 0 OR p_cost < 0
     OR p_status NOT IN (
       'draft', 'ready', 'processing', 'paused', 'completed', 'failed'
     ) THEN
    RETURN false;
  END IF;

  IF p_active_phase IS NOT NULL
     AND p_active_phase NOT IN ('description', 'images', 'full') THEN
    RETURN false;
  END IF;

  UPDATE public.visualizer_sessions
  SET
    total_credits = total_credits + ROUND(p_credits, 3),
    total_cost = total_cost + ROUND(p_cost, 6),
    ready_rows = GREATEST(0, p_ready_rows),
    failed_rows = GREATEST(0, p_failed_rows),
    status = p_status,
    error_message = p_error_message,
    awaiting_user_action = COALESCE(p_awaiting_user_action, false),
    active_phase = p_active_phase,
    cancel_requested = false,
    updated_at = NOW()
  WHERE id = p_session_id
    AND workspace_id = p_workspace_id
  RETURNING id INTO updated_id;

  RETURN updated_id IS NOT NULL;
END;
$$;

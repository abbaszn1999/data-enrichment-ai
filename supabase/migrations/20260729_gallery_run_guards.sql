-- Atomic run claim and usage accumulation for the storage-first gallery model.

CREATE OR REPLACE FUNCTION public.claim_gallery_session_run(
  p_session_id uuid,
  p_workspace_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  UPDATE public.gallery_sessions
  SET status = 'processing', error_message = NULL, updated_at = NOW()
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

CREATE OR REPLACE FUNCTION public.add_gallery_session_usage(
  p_session_id uuid,
  p_workspace_id uuid,
  p_credits numeric,
  p_cost numeric,
  p_ready_rows integer,
  p_failed_rows integer,
  p_status text,
  p_error_message text DEFAULT NULL
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
     OR p_status NOT IN ('draft', 'ready', 'processing', 'completed', 'failed') THEN
    RETURN false;
  END IF;

  UPDATE public.gallery_sessions
  SET
    total_credits = total_credits + ROUND(p_credits, 3),
    total_cost = total_cost + ROUND(p_cost, 6),
    ready_rows = GREATEST(0, p_ready_rows),
    failed_rows = GREATEST(0, p_failed_rows),
    status = p_status,
    error_message = p_error_message,
    updated_at = NOW()
  WHERE id = p_session_id
    AND workspace_id = p_workspace_id
  RETURNING id INTO updated_id;

  RETURN updated_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_gallery_session_run(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_gallery_session_usage(
  uuid, uuid, numeric, numeric, integer, integer, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_gallery_session_run(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.add_gallery_session_usage(
  uuid, uuid, numeric, numeric, integer, integer, text, text
) TO service_role;

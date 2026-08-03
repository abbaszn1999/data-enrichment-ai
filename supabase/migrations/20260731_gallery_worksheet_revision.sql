-- Optimistic concurrency for worksheet autosave.

ALTER TABLE public.gallery_sessions
  ADD COLUMN IF NOT EXISTS worksheet_revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_gallery_worksheet_revision(
  p_session_id uuid,
  p_workspace_id uuid,
  p_expected_revision bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_revision bigint;
BEGIN
  UPDATE public.gallery_sessions
  SET worksheet_revision = worksheet_revision + 1
  WHERE id = p_session_id
    AND workspace_id = p_workspace_id
    AND worksheet_revision = p_expected_revision
  RETURNING worksheet_revision INTO next_revision;

  RETURN next_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_gallery_worksheet_revision(
  uuid, uuid, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gallery_worksheet_revision(
  uuid, uuid, bigint
) TO service_role;

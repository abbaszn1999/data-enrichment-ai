-- Products Gallery: persist user-editable configuration in Postgres.
-- Operational worksheet rows/results remain in Storage.

ALTER TABLE public.gallery_sessions
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS settings_revision bigint NOT NULL DEFAULT 0;

ALTER TABLE public.gallery_sessions
  DROP CONSTRAINT IF EXISTS gallery_sessions_settings_object_check;

ALTER TABLE public.gallery_sessions
  ADD CONSTRAINT gallery_sessions_settings_object_check
  CHECK (jsonb_typeof(settings) = 'object');

CREATE OR REPLACE FUNCTION public.save_gallery_session_settings(
  p_session_id uuid,
  p_workspace_id uuid,
  p_expected_revision bigint,
  p_settings jsonb
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
  SET
    settings = p_settings,
    settings_revision = settings_revision + 1
  WHERE id = p_session_id
    AND workspace_id = p_workspace_id
    AND settings_revision = p_expected_revision
  RETURNING settings_revision INTO next_revision;

  RETURN next_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.save_gallery_session_settings(
  uuid, uuid, bigint, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_gallery_session_settings(
  uuid, uuid, bigint, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_gallery_manual_save(
  p_session_id uuid,
  p_workspace_id uuid,
  p_expected_settings_revision bigint,
  p_expected_worksheet_revision bigint,
  p_settings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  revisions jsonb;
BEGIN
  UPDATE public.gallery_sessions
  SET
    settings = p_settings,
    settings_revision = settings_revision + 1,
    worksheet_revision = worksheet_revision + 1
  WHERE id = p_session_id
    AND workspace_id = p_workspace_id
    AND settings_revision = p_expected_settings_revision
    AND worksheet_revision = p_expected_worksheet_revision
    AND status <> 'processing'
  RETURNING jsonb_build_object(
    'settingsRevision', settings_revision,
    'worksheetRevision', worksheet_revision
  ) INTO revisions;

  RETURN revisions;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_gallery_manual_save(
  uuid, uuid, bigint, bigint, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gallery_manual_save(
  uuid, uuid, bigint, bigint, jsonb
) TO service_role;

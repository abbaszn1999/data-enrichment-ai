-- Description Visualizer: thin session metadata + Storage worksheet/results.
-- Mirrors gallery_sessions pattern.

CREATE TABLE IF NOT EXISTS public.visualizer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'ready',
      'processing',
      'paused',
      'completed',
      'failed'
    )),
  source_file_name TEXT NOT NULL DEFAULT '',
  storage_path TEXT,
  images_prefix TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  ready_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  total_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  total_credits NUMERIC(12, 3) NOT NULL DEFAULT 0,
  error_message TEXT,
  awaiting_user_action BOOLEAN NOT NULL DEFAULT false,
  active_phase TEXT
    CHECK (active_phase IS NULL OR active_phase IN ('description', 'images')),
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  worksheet_revision BIGINT NOT NULL DEFAULT 0,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings_revision BIGINT NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT visualizer_sessions_settings_object_check
    CHECK (jsonb_typeof(settings) = 'object')
);

CREATE INDEX IF NOT EXISTS visualizer_sessions_workspace_idx
  ON public.visualizer_sessions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS visualizer_sessions_cancel_requested_idx
  ON public.visualizer_sessions (id, workspace_id)
  WHERE cancel_requested = true;

ALTER TABLE public.visualizer_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visualizer_sessions_select" ON public.visualizer_sessions;
DROP POLICY IF EXISTS "visualizer_sessions_insert" ON public.visualizer_sessions;
DROP POLICY IF EXISTS "visualizer_sessions_update" ON public.visualizer_sessions;
DROP POLICY IF EXISTS "visualizer_sessions_delete" ON public.visualizer_sessions;

CREATE POLICY "visualizer_sessions_select" ON public.visualizer_sessions
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "visualizer_sessions_insert" ON public.visualizer_sessions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "visualizer_sessions_update" ON public.visualizer_sessions
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "visualizer_sessions_delete" ON public.visualizer_sessions
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

CREATE OR REPLACE FUNCTION public.set_visualizer_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS visualizer_sessions_updated_at ON public.visualizer_sessions;

CREATE TRIGGER visualizer_sessions_updated_at
  BEFORE UPDATE ON public.visualizer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_visualizer_sessions_updated_at();

CREATE OR REPLACE FUNCTION public.save_visualizer_session_settings(
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
  UPDATE public.visualizer_sessions
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

REVOKE ALL ON FUNCTION public.save_visualizer_session_settings(
  uuid, uuid, bigint, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_visualizer_session_settings(
  uuid, uuid, bigint, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_visualizer_worksheet_revision(
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
  UPDATE public.visualizer_sessions
  SET worksheet_revision = worksheet_revision + 1
  WHERE id = p_session_id
    AND workspace_id = p_workspace_id
    AND worksheet_revision = p_expected_revision
  RETURNING worksheet_revision INTO next_revision;

  RETURN next_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_visualizer_worksheet_revision(
  uuid, uuid, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_visualizer_worksheet_revision(
  uuid, uuid, bigint
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_visualizer_manual_save(
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
  UPDATE public.visualizer_sessions
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

REVOKE ALL ON FUNCTION public.claim_visualizer_manual_save(
  uuid, uuid, bigint, bigint, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_visualizer_manual_save(
  uuid, uuid, bigint, bigint, jsonb
) TO service_role;

-- Allow visualizer credit operations (preserve existing allowed ops).
ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_operation_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_operation_check
  CHECK (operation = ANY (ARRAY[
    'ai_enrichment'::text,
    'ai_image_search'::text,
    'ai_column_mapping'::text,
    'ai_category_suggest'::text,
    'ai_function'::text,
    'image_classification'::text,
    'gallery_google'::text,
    'gallery_ai'::text,
    'visualizer_description'::text,
    'visualizer_images'::text,
    'credit_topup'::text,
    'monthly_reset'::text
  ]));

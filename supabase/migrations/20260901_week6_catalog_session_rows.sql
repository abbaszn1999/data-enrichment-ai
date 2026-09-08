-- Week 6 / Root Cause A: Catalog Intelligence session rows in Postgres.
-- Dual-write with projects/{sessionId}.json continues for cold checkpoints.

CREATE TABLE IF NOT EXISTS public.catalog_session_rows (
  session_id uuid NOT NULL REFERENCES public.catalog_sessions(id) ON DELETE CASCADE,
  row_id text NOT NULL,
  row_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  original_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  enriched_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_type text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, row_id)
);

CREATE INDEX IF NOT EXISTS catalog_session_rows_session_idx
  ON public.catalog_session_rows (session_id, row_index);

ALTER TABLE public.catalog_session_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_session_rows_member_select ON public.catalog_session_rows;
CREATE POLICY catalog_session_rows_member_select
  ON public.catalog_session_rows
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.catalog_sessions s
      JOIN public.workspace_members m ON m.workspace_id = s.workspace_id
      WHERE s.id = catalog_session_rows.session_id
        AND m.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.catalog_session_rows FROM PUBLIC, anon;
GRANT SELECT ON public.catalog_session_rows TO authenticated;
GRANT ALL ON public.catalog_session_rows TO service_role;

CREATE OR REPLACE FUNCTION public.delete_catalog_session_rows_except(
  p_session_id uuid,
  p_keep_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.catalog_session_rows
  WHERE session_id = p_session_id
    AND NOT (row_id = ANY (COALESCE(p_keep_ids, ARRAY[]::text[])));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_catalog_session_rows_except(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_catalog_session_rows_except(uuid, text[])
  TO service_role;

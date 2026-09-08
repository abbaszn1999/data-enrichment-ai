-- Week 7 / Root Cause A: Gallery worksheet rows in Postgres.
-- Dual-write with gallery worksheet.json continues for cold checkpoints.

CREATE TABLE IF NOT EXISTS public.gallery_session_rows (
  session_id uuid NOT NULL REFERENCES public.gallery_sessions(id) ON DELETE CASCADE,
  row_id text NOT NULL,
  row_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_started',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, row_id)
);

CREATE INDEX IF NOT EXISTS gallery_session_rows_session_idx
  ON public.gallery_session_rows (session_id, row_index);

ALTER TABLE public.gallery_session_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gallery_session_rows_member_select ON public.gallery_session_rows;
CREATE POLICY gallery_session_rows_member_select
  ON public.gallery_session_rows
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.gallery_sessions s
      JOIN public.workspace_members m ON m.workspace_id = s.workspace_id
      WHERE s.id = gallery_session_rows.session_id
        AND m.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.gallery_session_rows FROM PUBLIC, anon;
GRANT SELECT ON public.gallery_session_rows TO authenticated;
GRANT ALL ON public.gallery_session_rows TO service_role;

CREATE OR REPLACE FUNCTION public.delete_gallery_session_rows_except(
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
  DELETE FROM public.gallery_session_rows
  WHERE session_id = p_session_id
    AND NOT (row_id = ANY (COALESCE(p_keep_ids, ARRAY[]::text[])));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_gallery_session_rows_except(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_gallery_session_rows_except(uuid, text[])
  TO service_role;

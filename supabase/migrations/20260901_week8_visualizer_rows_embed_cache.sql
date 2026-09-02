-- Week 8 / Root Cause A: Visualizer worksheet rows + embed page cache.
-- Dual-write with visualizer worksheet.json continues for cold checkpoints.

CREATE TABLE IF NOT EXISTS public.visualizer_session_rows (
  session_id uuid NOT NULL REFERENCES public.visualizer_sessions(id) ON DELETE CASCADE,
  row_id text NOT NULL,
  row_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'not_started',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, row_id)
);

CREATE INDEX IF NOT EXISTS visualizer_session_rows_session_idx
  ON public.visualizer_session_rows (session_id, row_index);

ALTER TABLE public.visualizer_session_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visualizer_session_rows_member_select ON public.visualizer_session_rows;
CREATE POLICY visualizer_session_rows_member_select
  ON public.visualizer_session_rows
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.visualizer_sessions s
      JOIN public.workspace_members m ON m.workspace_id = s.workspace_id
      WHERE s.id = visualizer_session_rows.session_id
        AND m.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.visualizer_session_rows FROM PUBLIC, anon;
GRANT SELECT ON public.visualizer_session_rows TO authenticated;
GRANT ALL ON public.visualizer_session_rows TO service_role;

CREATE OR REPLACE FUNCTION public.delete_visualizer_session_rows_except(
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
  DELETE FROM public.visualizer_session_rows
  WHERE session_id = p_session_id
    AND NOT (row_id = ANY (COALESCE(p_keep_ids, ARRAY[]::text[])));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_visualizer_session_rows_except(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_visualizer_session_rows_except(uuid, text[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.credit_usage_totals(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_used', COALESCE(SUM(credits_used) FILTER (WHERE credits_used > 0), 0),
    'total_count', COUNT(*)
  )
  FROM public.credit_transactions
  WHERE workspace_id = p_workspace_id;
$$;

REVOKE ALL ON FUNCTION public.credit_usage_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_usage_totals(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wallet_spend_summaries(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'spent7', COALESCE((
      SELECT SUM(ABS(amount_usd)) FROM public.wallet_transactions
      WHERE workspace_id = p_workspace_id AND amount_usd < 0
        AND created_at >= now() - interval '7 days'
    ), 0),
    'spent30', COALESCE((
      SELECT SUM(ABS(amount_usd)) FROM public.wallet_transactions
      WHERE workspace_id = p_workspace_id AND amount_usd < 0
        AND created_at >= now() - interval '30 days'
    ), 0),
    'by_module', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('module', module, 'amount', amt) ORDER BY amt DESC)
      FROM (
        SELECT COALESCE(module, '') AS module, SUM(ABS(amount_usd)) AS amt
        FROM public.wallet_transactions
        WHERE workspace_id = p_workspace_id AND amount_usd < 0
        GROUP BY 1
      ) s
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.wallet_spend_summaries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_spend_summaries(uuid) TO authenticated, service_role;

-- Issue 8.1: denormalised storefront widget payload. Public reads are PK lookups.
CREATE TABLE IF NOT EXISTS public.embed_page_cache (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain text NOT NULL,
  handle text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, domain, handle)
);

CREATE INDEX IF NOT EXISTS embed_page_cache_domain_handle_idx
  ON public.embed_page_cache (domain, handle);

ALTER TABLE public.embed_page_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS embed_page_cache_member_select ON public.embed_page_cache;
CREATE POLICY embed_page_cache_member_select
  ON public.embed_page_cache
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members m
      WHERE m.workspace_id = embed_page_cache.workspace_id
        AND m.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.embed_page_cache FROM PUBLIC, anon;
GRANT SELECT ON public.embed_page_cache TO authenticated;
GRANT ALL ON public.embed_page_cache TO service_role;

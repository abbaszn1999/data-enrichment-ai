-- Week 5 / Root Cause A: master catalog rows in Postgres.
-- Dual-write with products.json continues until every reader is migrated.
-- Table name is workspace_products (plan shape: workspace_id, sku, data jsonb).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.workspace_products (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sku text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_text text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, sku)
);

CREATE INDEX IF NOT EXISTS workspace_products_search_trgm_idx
  ON public.workspace_products USING gin (search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.workspace_product_columns (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  columns text[] NOT NULL DEFAULT '{}'::text[],
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_product_columns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_products_member_select ON public.workspace_products;
CREATE POLICY workspace_products_member_select
  ON public.workspace_products
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members m
      WHERE m.workspace_id = workspace_products.workspace_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS workspace_product_columns_member_select ON public.workspace_product_columns;
CREATE POLICY workspace_product_columns_member_select
  ON public.workspace_product_columns
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members m
      WHERE m.workspace_id = workspace_product_columns.workspace_id
        AND m.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.workspace_products FROM PUBLIC, anon;
GRANT SELECT ON public.workspace_products TO authenticated;
GRANT ALL ON public.workspace_products TO service_role;

REVOKE ALL ON public.workspace_product_columns FROM PUBLIC, anon;
GRANT SELECT ON public.workspace_product_columns TO authenticated;
GRANT ALL ON public.workspace_product_columns TO service_role;

CREATE OR REPLACE FUNCTION public.delete_workspace_products_except(
  p_workspace_id uuid,
  p_keep_skus text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.workspace_products
  WHERE workspace_id = p_workspace_id
    AND NOT (sku = ANY (COALESCE(p_keep_skus, ARRAY[]::text[])));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_workspace_products_except(uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workspace_products_except(uuid, text[])
  TO service_role;

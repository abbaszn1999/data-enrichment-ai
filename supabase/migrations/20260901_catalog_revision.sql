-- Optimistic concurrency for the master catalog blob (Issue 3.5 / P0-4).
-- claim_catalog_revision is a single-statement compare-and-swap so concurrent
-- apply/upload writers cannot silently discard each other's SKUs.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS catalog_revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_catalog_revision(
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
  UPDATE public.workspaces
  SET catalog_revision = catalog_revision + 1,
      updated_at = now()
  WHERE id = p_workspace_id
    AND catalog_revision = p_expected_revision
  RETURNING catalog_revision INTO next_revision;

  RETURN next_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_catalog_revision(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_catalog_revision(uuid, bigint)
  TO service_role;

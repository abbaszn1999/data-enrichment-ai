-- Website Restructure: replace the fixed "3 active projects" cap with a
-- lifetime, plan-based limit so deleting a project never frees up a new slot.
--
-- One counter column on `workspaces`, incremented only on project creation,
-- never decremented on delete. The app maps the workspace's current
-- subscription plan (starter/growth/pro) to a limit and compares it against
-- this counter at creation time (see src/lib/website-restructure/types.ts).

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS wr_projects_created_total integer NOT NULL DEFAULT 0;

-- Atomically reserve a slot: increments the lifetime counter only if it is
-- still under the caller-supplied limit, in one round trip, so two concurrent
-- creation requests can't both slip past the check.
CREATE OR REPLACE FUNCTION public.wr_try_reserve_project_slot(p_workspace_id uuid, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched uuid;
BEGIN
  UPDATE public.workspaces
  SET wr_projects_created_total = wr_projects_created_total + 1
  WHERE id = p_workspace_id
    AND wr_projects_created_total < p_limit
  RETURNING id INTO v_matched;

  RETURN v_matched IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.wr_try_reserve_project_slot(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wr_try_reserve_project_slot(uuid, integer) TO service_role;

-- Compensating rollback for when a reserved slot's project insert fails.
CREATE OR REPLACE FUNCTION public.wr_release_project_slot(p_workspace_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.workspaces
  SET wr_projects_created_total = GREATEST(0, wr_projects_created_total - 1)
  WHERE id = p_workspace_id;
$$;

REVOKE ALL ON FUNCTION public.wr_release_project_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wr_release_project_slot(uuid) TO service_role;

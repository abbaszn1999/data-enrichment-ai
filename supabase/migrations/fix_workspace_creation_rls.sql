-- Fix: Workspace creation fails due to RLS chicken-and-egg problem.
-- The user can insert into `workspaces` (owner_id = auth.uid()),
-- but cannot insert into `workspace_members` because the policy
-- requires is_workspace_member() which checks existing membership.
-- Same issue for `workspace_subscriptions`.
--
-- Solution: A SECURITY DEFINER function that does all 3 inserts atomically.

CREATE OR REPLACE FUNCTION create_workspace_for_user(
  ws_name TEXT,
  ws_slug TEXT,
  ws_description TEXT DEFAULT '',
  ws_cms_type TEXT DEFAULT 'custom'
)
RETURNS JSON AS $$
DECLARE
  new_workspace workspaces%ROWTYPE;
  starter_plan_id UUID;
BEGIN
  -- Verify the caller is authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create workspace
  INSERT INTO workspaces (name, slug, description, cms_type, owner_id)
  VALUES (ws_name, ws_slug, ws_description, ws_cms_type, auth.uid())
  RETURNING * INTO new_workspace;

  -- Add creator as owner member
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace.id, auth.uid(), 'owner');

  -- Auto-assign Starter plan
  SELECT id INTO starter_plan_id
  FROM subscription_plans
  WHERE name = 'starter'
  LIMIT 1;

  IF starter_plan_id IS NOT NULL THEN
    INSERT INTO workspace_subscriptions (workspace_id, plan_id)
    VALUES (new_workspace.id, starter_plan_id);
  END IF;

  RETURN row_to_json(new_workspace);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

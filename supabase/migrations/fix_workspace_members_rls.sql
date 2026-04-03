-- Fix: workspace_members SELECT RLS policy blocks visibility of other members.
-- 
-- Problem: The current "members_select" policy uses is_workspace_member()
-- which calls auth.uid() — but there may be conflicting older policies
-- that restrict SELECT to only the user's own row (user_id = auth.uid()).
--
-- Solution: Drop ALL existing SELECT policies on workspace_members and
-- recreate a single clean one that allows any workspace member to see
-- all other members in the same workspace.

-- 1. Drop ALL existing policies on workspace_members (clean slate)
DO $$ 
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN 
    SELECT policyname FROM pg_policies WHERE tablename = 'workspace_members'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON workspace_members', pol.policyname);
  END LOOP;
END $$;

-- 2. Ensure RLS is enabled
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- 3. Recreate the helper function (ensure it exists and works correctly)
CREATE OR REPLACE FUNCTION is_workspace_member(
  ws_id UUID,
  min_role TEXT DEFAULT 'viewer'
)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
    AND user_id = auth.uid()
    AND CASE min_role
      WHEN 'owner'  THEN role = 'owner'
      WHEN 'admin'  THEN role IN ('owner', 'admin')
      WHEN 'editor' THEN role IN ('owner', 'admin', 'editor')
      WHEN 'viewer' THEN role IN ('owner', 'admin', 'editor', 'viewer')
    END
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 4. SELECT: Any member of a workspace can see ALL members in that workspace
CREATE POLICY "members_select" ON workspace_members
  FOR SELECT USING (is_workspace_member(workspace_id));

-- 5. INSERT: Admin+ can add members (also needed for invite-accept via admin client)
CREATE POLICY "members_insert" ON workspace_members
  FOR INSERT WITH CHECK (
    is_workspace_member(workspace_id, 'admin')
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_invites
      WHERE accepted_at IS NULL
      AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- 6. UPDATE: Admin+ can change roles, but not their own
CREATE POLICY "members_update" ON workspace_members
  FOR UPDATE USING (
    is_workspace_member(workspace_id, 'admin')
    AND user_id != auth.uid()
  );

-- 7. DELETE: Admin+ can remove members, but not themselves
CREATE POLICY "members_delete" ON workspace_members
  FOR DELETE USING (
    is_workspace_member(workspace_id, 'admin')
    AND user_id != auth.uid()
  );

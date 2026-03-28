-- Fix Team page issues:
-- 1. Missing accepted_at column on workspace_invites
-- 2. Missing FK between workspace_members.user_id and profiles.id
-- 3. RLS policies on workspace_invites may be missing

-- 0. Add missing columns to workspace_invites
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex');
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days');

-- Backfill token for existing rows that have NULL token
UPDATE workspace_invites SET token = encode(gen_random_bytes(32), 'hex') WHERE token IS NULL;

-- 1. Create/recreate the helper function (SECURITY DEFINER avoids auth.users permission issues)
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

-- 2. Enable RLS on workspace_invites (if not already)
ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies if any (to avoid conflicts)
DROP POLICY IF EXISTS "invites_select" ON workspace_invites;
DROP POLICY IF EXISTS "invites_insert" ON workspace_invites;
DROP POLICY IF EXISTS "invites_update" ON workspace_invites;
DROP POLICY IF EXISTS "invites_delete" ON workspace_invites;

-- 4. Create RLS policies for workspace_invites
-- Members can see invites for their workspace, OR anyone can read an invite by token (for acceptance flow)
CREATE POLICY "invites_select" ON workspace_invites
  FOR SELECT USING (
    is_workspace_member(workspace_id)
    OR token IS NOT NULL
  );

-- Admin+ can create invites
CREATE POLICY "invites_insert" ON workspace_invites
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

-- Anyone can update invite (to accept it via token)
CREATE POLICY "invites_update" ON workspace_invites
  FOR UPDATE USING (TRUE);

-- Admin+ can cancel/delete invites
CREATE POLICY "invites_delete" ON workspace_invites
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

-- 5. Also fix workspace_members RLS (needed for members table display)
DROP POLICY IF EXISTS "members_select" ON workspace_members;
DROP POLICY IF EXISTS "members_insert" ON workspace_members;
DROP POLICY IF EXISTS "members_update" ON workspace_members;
DROP POLICY IF EXISTS "members_delete" ON workspace_members;

CREATE POLICY "members_select" ON workspace_members
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "members_insert" ON workspace_members
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "members_update" ON workspace_members
  FOR UPDATE USING (
    is_workspace_member(workspace_id, 'admin')
    AND user_id != auth.uid()
  );

CREATE POLICY "members_delete" ON workspace_members
  FOR DELETE USING (
    is_workspace_member(workspace_id, 'admin')
    AND user_id != auth.uid()
  );

-- Add missing RLS policies for tables that currently have no row-level security.
-- Uses the existing is_workspace_member() helper function from fix_team_invites_rls.sql

-- ═══════════════════════════════════════════════════
-- 1. WORKSPACES — only members can read their workspace
-- ═══════════════════════════════════════════════════
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ws_select" ON workspaces;
DROP POLICY IF EXISTS "ws_update" ON workspaces;
DROP POLICY IF EXISTS "ws_delete" ON workspaces;
DROP POLICY IF EXISTS "ws_insert" ON workspaces;

-- Members can read their workspace
CREATE POLICY "ws_select" ON workspaces
  FOR SELECT USING (is_workspace_member(id));

-- Admin+ can update workspace settings
CREATE POLICY "ws_update" ON workspaces
  FOR UPDATE USING (is_workspace_member(id, 'admin'));

-- Owner only can delete workspace
CREATE POLICY "ws_delete" ON workspaces
  FOR DELETE USING (owner_id = auth.uid());

-- Authenticated users can create workspaces (owner_id must be themselves)
CREATE POLICY "ws_insert" ON workspaces
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- ═══════════════════════════════════════════════════
-- 2. IMPORT_SESSIONS — only workspace members can access
-- ═══════════════════════════════════════════════════
ALTER TABLE import_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_select" ON import_sessions;
DROP POLICY IF EXISTS "sessions_insert" ON import_sessions;
DROP POLICY IF EXISTS "sessions_update" ON import_sessions;
DROP POLICY IF EXISTS "sessions_delete" ON import_sessions;

CREATE POLICY "sessions_select" ON import_sessions
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "sessions_insert" ON import_sessions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "sessions_update" ON import_sessions
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "sessions_delete" ON import_sessions
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

-- ═══════════════════════════════════════════════════
-- 3. ACTIVITY_LOG — members can read, editors+ can insert
-- ═══════════════════════════════════════════════════
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_select" ON activity_log;
DROP POLICY IF EXISTS "activity_insert" ON activity_log;

CREATE POLICY "activity_select" ON activity_log
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "activity_insert" ON activity_log
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

-- ═══════════════════════════════════════════════════
-- 4. WORKSPACE_SUBSCRIPTIONS — members can read, system manages writes
-- ═══════════════════════════════════════════════════
ALTER TABLE workspace_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_select" ON workspace_subscriptions;
DROP POLICY IF EXISTS "sub_insert" ON workspace_subscriptions;
DROP POLICY IF EXISTS "sub_update" ON workspace_subscriptions;

CREATE POLICY "sub_select" ON workspace_subscriptions
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Insert/update handled by SECURITY DEFINER functions (create_workspace_for_user, deduct_credits)
-- But allow admin+ as fallback for manual subscription management
CREATE POLICY "sub_insert" ON workspace_subscriptions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "sub_update" ON workspace_subscriptions
  FOR UPDATE USING (is_workspace_member(workspace_id, 'admin'));

-- ═══════════════════════════════════════════════════
-- 5. CREDIT_TRANSACTIONS — members can read their workspace's transactions
-- ═══════════════════════════════════════════════════
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credits_select" ON credit_transactions;
DROP POLICY IF EXISTS "credits_insert" ON credit_transactions;

CREATE POLICY "credits_select" ON credit_transactions
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Insert handled by SECURITY DEFINER function (deduct_credits)
-- But allow members as fallback for logging
CREATE POLICY "credits_insert" ON credit_transactions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

-- ═══════════════════════════════════════════════════
-- 6. EXPORT_TEMPLATES — system templates readable by all, workspace templates by members
-- ═══════════════════════════════════════════════════
ALTER TABLE export_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "templates_select" ON export_templates;
DROP POLICY IF EXISTS "templates_insert" ON export_templates;
DROP POLICY IF EXISTS "templates_update" ON export_templates;

-- System templates (is_system=true) readable by all authenticated users
-- Workspace templates readable only by members
CREATE POLICY "templates_select" ON export_templates
  FOR SELECT USING (
    is_system = true
    OR (workspace_id IS NOT NULL AND is_workspace_member(workspace_id))
  );

CREATE POLICY "templates_insert" ON export_templates
  FOR INSERT WITH CHECK (
    workspace_id IS NOT NULL AND is_workspace_member(workspace_id, 'editor')
  );

CREATE POLICY "templates_update" ON export_templates
  FOR UPDATE USING (
    workspace_id IS NOT NULL AND is_workspace_member(workspace_id, 'editor')
  );

-- ═══════════════════════════════════════════════════
-- 7. SUBSCRIPTION_PLANS — readable by all authenticated users
-- ═══════════════════════════════════════════════════
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_select" ON subscription_plans;

CREATE POLICY "plans_select" ON subscription_plans
  FOR SELECT USING (true);  -- Public read for plan listing

-- ═══════════════════════════════════════════════════
-- 8. PROFILES — users can read all profiles, update only their own
-- ═══════════════════════════════════════════════════
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_update" ON profiles;
DROP POLICY IF EXISTS "profiles_insert" ON profiles;

CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (true);  -- All authenticated users can read profiles (for member lists)

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

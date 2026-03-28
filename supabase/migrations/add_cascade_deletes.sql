-- Add ON DELETE CASCADE to foreign keys referencing workspaces.
-- When a workspace is deleted, all related data is automatically cleaned up.
-- 
-- NOTE: ALTER CONSTRAINT doesn't exist in PostgreSQL — we must DROP and re-ADD.

-- ═══════════════════════════════════════════════════
-- 1. workspace_members → workspaces
-- ═══════════════════════════════════════════════════
ALTER TABLE workspace_members
  DROP CONSTRAINT IF EXISTS workspace_members_workspace_id_fkey;
ALTER TABLE workspace_members
  ADD CONSTRAINT workspace_members_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════
-- 2. workspace_invites → workspaces
-- ═══════════════════════════════════════════════════
ALTER TABLE workspace_invites
  DROP CONSTRAINT IF EXISTS workspace_invites_workspace_id_fkey;
ALTER TABLE workspace_invites
  ADD CONSTRAINT workspace_invites_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════
-- 3. import_sessions → workspaces
-- ═══════════════════════════════════════════════════
ALTER TABLE import_sessions
  DROP CONSTRAINT IF EXISTS import_sessions_workspace_id_fkey;
ALTER TABLE import_sessions
  ADD CONSTRAINT import_sessions_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════
-- 4. activity_log → workspaces
-- ═══════════════════════════════════════════════════
ALTER TABLE activity_log
  DROP CONSTRAINT IF EXISTS activity_log_workspace_id_fkey;
ALTER TABLE activity_log
  ADD CONSTRAINT activity_log_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════
-- 5. workspace_subscriptions → workspaces
-- ═══════════════════════════════════════════════════
ALTER TABLE workspace_subscriptions
  DROP CONSTRAINT IF EXISTS workspace_subscriptions_workspace_id_fkey;
ALTER TABLE workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════
-- 6. credit_transactions → workspaces
-- ═══════════════════════════════════════════════════
ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_workspace_id_fkey;
ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════
-- 7. export_templates → workspaces (nullable FK)
-- ═══════════════════════════════════════════════════
ALTER TABLE export_templates
  DROP CONSTRAINT IF EXISTS export_templates_workspace_id_fkey;
ALTER TABLE export_templates
  ADD CONSTRAINT export_templates_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

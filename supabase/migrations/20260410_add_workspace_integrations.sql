CREATE TABLE IF NOT EXISTS workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('shopify', 'woocommerce', 'wordpress')),
  integration_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_integrations_workspace_id
  ON workspace_integrations(workspace_id);

ALTER TABLE workspace_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_integrations_select" ON workspace_integrations;
CREATE POLICY "workspace_integrations_select" ON workspace_integrations
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace_integrations_insert" ON workspace_integrations;
CREATE POLICY "workspace_integrations_insert" ON workspace_integrations
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

DROP POLICY IF EXISTS "workspace_integrations_update" ON workspace_integrations;
CREATE POLICY "workspace_integrations_update" ON workspace_integrations
  FOR UPDATE USING (is_workspace_member(workspace_id, 'admin'))
  WITH CHECK (is_workspace_member(workspace_id, 'admin'));

DROP POLICY IF EXISTS "workspace_integrations_delete" ON workspace_integrations;
CREATE POLICY "workspace_integrations_delete" ON workspace_integrations
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

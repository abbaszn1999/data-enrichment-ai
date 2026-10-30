-- Google Ads agent — DRAFT schema. Not a migration; do not apply as is.
-- Mirrors workspace_integrations conventions: workspace scoped, RLS through
-- is_workspace_member(workspace_id, role).

CREATE TABLE IF NOT EXISTS google_ads_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  -- AES-GCM via src/lib/integrations/crypto.ts; never returned to the client.
  refresh_token_encrypted TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/adwords'],
  active_customer_id TEXT,
  -- Manager account the active customer is reached through (login-customer-id header).
  login_customer_id TEXT,
  auto_approve BOOLEAN NOT NULL DEFAULT FALSE,
  daily_operation_budget INTEGER NOT NULL DEFAULT 500,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'revoked', 'error')),
  connected_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id)
);

CREATE TABLE IF NOT EXISTS google_ads_accounts (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  is_manager BOOLEAN NOT NULL DEFAULT FALSE,
  manager_customer_id TEXT,
  listed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, customer_id)
);

CREATE TABLE IF NOT EXISTS google_ads_report_cache (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  -- e.g. 'snapshot', 'search_terms', 'daily'
  kind TEXT NOT NULL,
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, customer_id, kind, range_start, range_end)
);

CREATE TABLE IF NOT EXISTS google_ads_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('agent', 'user', 'recommendation')),
  title TEXT NOT NULL,
  rationale TEXT,
  impact TEXT,
  risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  ops JSONB NOT NULL,
  diff JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
  error TEXT,
  conversation_id TEXT,
  proposed_by UUID REFERENCES auth.users(id),
  decided_by UUID REFERENCES auth.users(id),
  decided_at TIMESTAMPTZ,
  -- Raw mutate response (resource names of created entities).
  google_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_ads_changes_pending
  ON google_ads_changes(workspace_id, customer_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS google_ads_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  change_id UUID REFERENCES google_ads_changes(id) ON DELETE SET NULL,
  actor UUID REFERENCES auth.users(id),
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  diff JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Ops that revert this event; NULL when it can't be undone.
  inverse_ops JSONB,
  undone_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_ads_change_events_recent
  ON google_ads_change_events(workspace_id, customer_id, created_at DESC);

-- RLS: members read; editors decide changes; admins manage the connection.
ALTER TABLE google_ads_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_report_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_change_events ENABLE ROW LEVEL SECURITY;

-- The connection row holds the encrypted token: only the service role reads it.
-- Clients get connection status through an API route.
CREATE POLICY "google_ads_accounts_select" ON google_ads_accounts
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "google_ads_changes_select" ON google_ads_changes
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "google_ads_change_events_select" ON google_ads_change_events
  FOR SELECT USING (is_workspace_member(workspace_id));
-- Writes go through API routes with the service role after a role check.

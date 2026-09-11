-- Workspace Google Search Console + GA4 connections (encrypted tokens)
-- and URL-filter rules used later by PLP / Products analytics tabs.

CREATE TABLE IF NOT EXISTS public.workspace_analytics_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_type text NOT NULL CHECK (connection_type IN ('search-console', 'google-analytics')),
  connected_email text,
  selected_property text,
  property_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, connection_type)
);

CREATE INDEX IF NOT EXISTS workspace_analytics_connections_workspace_idx
  ON public.workspace_analytics_connections (workspace_id);

CREATE TABLE IF NOT EXISTS public.workspace_analytics_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_type text NOT NULL CHECK (page_type IN ('plp', 'products')),
  filter_mode text NOT NULL CHECK (filter_mode IN ('include', 'exclude')),
  pattern_type text NOT NULL CHECK (pattern_type IN ('simple', 'regex')),
  patterns jsonb NOT NULL DEFAULT '{"logic":"OR","rules":[]}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, page_type)
);

CREATE INDEX IF NOT EXISTS workspace_analytics_rules_workspace_idx
  ON public.workspace_analytics_rules (workspace_id);

ALTER TABLE public.workspace_analytics_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_analytics_rules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workspace_analytics_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.workspace_analytics_rules FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_analytics_connections TO service_role;
GRANT ALL ON public.workspace_analytics_rules TO service_role;

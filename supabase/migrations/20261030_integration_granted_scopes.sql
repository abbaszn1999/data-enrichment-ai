-- The access scopes the connected store granted (Shopify), kept with the
-- integration so the sidebar can lock tools that lack what they need without
-- asking Shopify on every page load. Refreshed on connect, on Recheck, when
-- older than an hour, and at the start of each Store Agent run.
-- NULL: not known (not checked yet, or a platform without scopes).

ALTER TABLE public.workspace_integrations
  ADD COLUMN IF NOT EXISTS granted_scopes TEXT[],
  ADD COLUMN IF NOT EXISTS scopes_checked_at TIMESTAMPTZ;

-- Canonical store domains for public embed lookup.
-- Embed must query this table by exact normalized_domain and must never
-- select workspace_integrations.config (live store credentials).

CREATE OR REPLACE FUNCTION public.normalize_store_domain(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(btrim(COALESCE(raw, ''))), '^https?://', ''),
            '/.*$',
            ''
          ),
          ':\d+$',
          ''
        ),
        '^www\.',
        ''
      ),
      ''
    ),
    ''
  );
$$;

CREATE TABLE IF NOT EXISTS public.workspace_domains (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  normalized_domain TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'integration',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (normalized_domain)
);

CREATE INDEX IF NOT EXISTS idx_workspace_domains_workspace_id
  ON public.workspace_domains(workspace_id);

ALTER TABLE public.workspace_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_domains_select" ON public.workspace_domains;
CREATE POLICY "workspace_domains_select" ON public.workspace_domains
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace_domains_insert" ON public.workspace_domains;
CREATE POLICY "workspace_domains_insert" ON public.workspace_domains
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

DROP POLICY IF EXISTS "workspace_domains_update" ON public.workspace_domains;
CREATE POLICY "workspace_domains_update" ON public.workspace_domains
  FOR UPDATE USING (is_workspace_member(workspace_id, 'admin'))
  WITH CHECK (is_workspace_member(workspace_id, 'admin'));

DROP POLICY IF EXISTS "workspace_domains_delete" ON public.workspace_domains;
CREATE POLICY "workspace_domains_delete" ON public.workspace_domains
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

INSERT INTO public.workspace_domains (workspace_id, normalized_domain, source)
SELECT workspace_id, public.normalize_store_domain(base_url), 'base_url'
FROM public.workspace_integrations
WHERE public.normalize_store_domain(base_url) <> ''
ON CONFLICT (normalized_domain) DO NOTHING;

INSERT INTO public.workspace_domains (workspace_id, normalized_domain, source)
SELECT workspace_id, public.normalize_store_domain(config->>'store_domain'), 'config.store_domain'
FROM public.workspace_integrations
WHERE public.normalize_store_domain(config->>'store_domain') <> ''
ON CONFLICT (normalized_domain) DO NOTHING;

INSERT INTO public.workspace_domains (workspace_id, normalized_domain, source)
SELECT workspace_id, public.normalize_store_domain(config->>'store_url'), 'config.store_url'
FROM public.workspace_integrations
WHERE public.normalize_store_domain(config->>'store_url') <> ''
ON CONFLICT (normalized_domain) DO NOTHING;

INSERT INTO public.workspace_domains (workspace_id, normalized_domain, source)
SELECT workspace_id, public.normalize_store_domain(config->>'shop'), 'config.shop'
FROM public.workspace_integrations
WHERE public.normalize_store_domain(config->>'shop') <> ''
ON CONFLICT (normalized_domain) DO NOTHING;

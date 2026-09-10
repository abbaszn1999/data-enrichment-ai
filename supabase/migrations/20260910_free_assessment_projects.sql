-- Free Assessment server persistence: projects, prefs, extracts, runs.
-- Mirrors the mr_* tables but stays fully separate so Free Assessment and
-- Growth Engine never share projects, extracts, runs, or billing.
-- Free Assessment stops at stage 5 (collections).

CREATE TABLE IF NOT EXISTS public.fa_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'archived')),
  store_label TEXT NOT NULL DEFAULT '',
  highlighted_collection_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(highlighted_collection_ids) = 'array'),
  market TEXT NOT NULL DEFAULT 'us-en',
  current_stage SMALLINT NOT NULL DEFAULT 1
    CHECK (current_stage BETWEEN 1 AND 5),
  opened_max_stage SMALLINT NOT NULL DEFAULT 1
    CHECK (opened_max_stage BETWEEN 1 AND 5),
  state JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(state) = 'object'),
  keywords_path TEXT,
  extract_rows INTEGER NOT NULL DEFAULT 0,
  extract_charged_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fa_projects_workspace_idx
  ON public.fa_projects (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.fa_workspace_prefs (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  active_project_id UUID REFERENCES public.fa_projects(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fa_extracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.fa_projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  market TEXT NOT NULL,
  database TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
  estimated_rows INTEGER NOT NULL DEFAULT 0,
  rows_returned INTEGER NOT NULL DEFAULT 0,
  held_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
  actual_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
  billing_status TEXT NOT NULL DEFAULT 'held'
    CHECK (billing_status IN ('held', 'settled', 'refunded', 'failed')),
  pump_lease_until TIMESTAMPTZ,
  job_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fa_extracts_project_idx
  ON public.fa_extracts (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fa_extracts_workspace_idx
  ON public.fa_extracts (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.fa_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.fa_projects(id) ON DELETE CASCADE,
  extract_id UUID REFERENCES public.fa_extracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('seed_probe', 'keyword_extract')),
  seed_id TEXT NOT NULL DEFAULT '',
  seed_term TEXT NOT NULL DEFAULT '',
  apify_run_id TEXT,
  dataset_id TEXT,
  next_cursor TEXT,
  pages INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
  rows_returned INTEGER NOT NULL DEFAULT 0,
  estimated_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fa_runs_apify_run_id_idx
  ON public.fa_runs (workspace_id, apify_run_id)
  WHERE apify_run_id IS NOT NULL AND btrim(apify_run_id) <> '';

CREATE INDEX IF NOT EXISTS fa_runs_extract_idx
  ON public.fa_runs (extract_id);

-- Reuses set_fa_updated_at() created by 20260909_free_assessment_wallet.sql.
DROP TRIGGER IF EXISTS fa_projects_updated_at ON public.fa_projects;
CREATE TRIGGER fa_projects_updated_at
  BEFORE UPDATE ON public.fa_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_fa_updated_at();

DROP TRIGGER IF EXISTS fa_extracts_updated_at ON public.fa_extracts;
CREATE TRIGGER fa_extracts_updated_at
  BEFORE UPDATE ON public.fa_extracts
  FOR EACH ROW EXECUTE FUNCTION public.set_fa_updated_at();

DROP TRIGGER IF EXISTS fa_runs_updated_at ON public.fa_runs;
CREATE TRIGGER fa_runs_updated_at
  BEFORE UPDATE ON public.fa_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_fa_updated_at();

-- Background extract worker job kind. Existing kinds preserved verbatim.
ALTER TABLE public.job_runs DROP CONSTRAINT IF EXISTS job_runs_kind_check;
ALTER TABLE public.job_runs ADD CONSTRAINT job_runs_kind_check CHECK (
  kind IN ('catalog', 'gallery', 'visualizer', 'mr_extract', 'fa_extract')
);

ALTER TABLE public.fa_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fa_workspace_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fa_extracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fa_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fa_projects_select" ON public.fa_projects;
DROP POLICY IF EXISTS "fa_projects_insert" ON public.fa_projects;
DROP POLICY IF EXISTS "fa_projects_update" ON public.fa_projects;
DROP POLICY IF EXISTS "fa_projects_delete" ON public.fa_projects;
CREATE POLICY "fa_projects_select" ON public.fa_projects
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "fa_projects_insert" ON public.fa_projects
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "fa_projects_update" ON public.fa_projects
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "fa_projects_delete" ON public.fa_projects
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

DROP POLICY IF EXISTS "fa_prefs_select" ON public.fa_workspace_prefs;
DROP POLICY IF EXISTS "fa_prefs_insert" ON public.fa_workspace_prefs;
DROP POLICY IF EXISTS "fa_prefs_update" ON public.fa_workspace_prefs;
CREATE POLICY "fa_prefs_select" ON public.fa_workspace_prefs
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "fa_prefs_insert" ON public.fa_workspace_prefs
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "fa_prefs_update" ON public.fa_workspace_prefs
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));

DROP POLICY IF EXISTS "fa_extracts_select" ON public.fa_extracts;
CREATE POLICY "fa_extracts_select" ON public.fa_extracts
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "fa_runs_select" ON public.fa_runs;
CREATE POLICY "fa_runs_select" ON public.fa_runs
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Website Restructure — Header Builder.
-- Single-stage tool, lean control table on the same pattern as mr_projects:
-- everything heavy (images, brief, taxonomy, competitor notes, code versions)
-- lives in object storage (`workspace-files`); this table only carries the
-- fields needed to render the projects rail and drive the phase machine.

CREATE TABLE IF NOT EXISTS public.wr_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  provider TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'collecting'
    CHECK (phase IN ('collecting','awaiting_images','awaiting_logo','awaiting_competitors','building','editing','locked','failed')),
  edit_messages_used SMALLINT NOT NULL DEFAULT 0 CHECK (edit_messages_used BETWEEN 0 AND 10),
  active_version SMALLINT NOT NULL DEFAULT 0,
  last_error TEXT,
  build_lease_until TIMESTAMPTZ,
  state JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wr_projects_workspace_idx
  ON public.wr_projects (workspace_id, updated_at DESC);

-- Reuses the same trigger function `set_mr_updated_at` created by the Market
-- Research migration — it only touches NEW.updated_at, nothing MR-specific.
DROP TRIGGER IF EXISTS wr_projects_updated_at ON public.wr_projects;
CREATE TRIGGER wr_projects_updated_at
  BEFORE UPDATE ON public.wr_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_updated_at();

ALTER TABLE public.wr_projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wr_projects_select" ON public.wr_projects;
DROP POLICY IF EXISTS "wr_projects_insert" ON public.wr_projects;
DROP POLICY IF EXISTS "wr_projects_update" ON public.wr_projects;
DROP POLICY IF EXISTS "wr_projects_delete" ON public.wr_projects;
CREATE POLICY "wr_projects_select" ON public.wr_projects
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "wr_projects_insert" ON public.wr_projects
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "wr_projects_update" ON public.wr_projects
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "wr_projects_delete" ON public.wr_projects
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

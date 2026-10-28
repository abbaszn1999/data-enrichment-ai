-- Store Agent: undo for approved store changes, and per-workspace store notes.

-- Before an approved change runs, the values it overwrites are saved to a
-- backup file in the chat (store-agent-files bucket). Undo replays them.
ALTER TABLE public.store_agent_approvals
  ADD COLUMN IF NOT EXISTS backup_path TEXT,
  ADD COLUMN IF NOT EXISTS undoable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS undone_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preview_file_id UUID REFERENCES public.store_agent_files(id) ON DELETE SET NULL;

-- What the merchant wants the agent to always know about the store: brand
-- voice, language, rules. Shared by everyone in the workspace; the agent can
-- add to it, the merchant can edit it.
CREATE TABLE IF NOT EXISTS public.store_agent_notes (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 8000),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.store_agent_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_agent_notes_select" ON public.store_agent_notes;
CREATE POLICY "store_agent_notes_select" ON public.store_agent_notes
  FOR SELECT USING (is_workspace_member(workspace_id));

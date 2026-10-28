-- Store Agent: plans from Plan mode.
-- In Plan mode the agent researches the store, asks what it needs, and writes
-- a plan (Cursor's createPlan). The plan shows in the panel with a model
-- picker and a Build button; asking for changes in the chat revises the same
-- plan (a new version). Build runs it in Agent mode in the same chat.

CREATE TABLE IF NOT EXISTS public.store_agent_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.store_agent_chats(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The run that wrote the latest version.
  run_id UUID REFERENCES public.store_agent_runs(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  -- Markdown, as the agent wrote it.
  content TEXT NOT NULL CHECK (char_length(content) <= 100000),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'building', 'built')),
  -- The Build run, while building and after.
  build_run_id UUID REFERENCES public.store_agent_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_agent_plans_chat
  ON public.store_agent_plans (chat_id, updated_at DESC);

ALTER TABLE public.store_agent_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_agent_plans_select" ON public.store_agent_plans;
CREATE POLICY "store_agent_plans_select" ON public.store_agent_plans
  FOR SELECT USING (
    is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.store_agent_chats c
      WHERE c.id = store_agent_plans.chat_id AND c.user_id = auth.uid()
    )
  );

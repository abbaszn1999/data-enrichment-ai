-- One row per Agent conversation. Message text stays in the Agent service's
-- store; this table only maps a conversation to its owner so it survives
-- redeploys and can be reopened after a page refresh.
CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_conversation_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_conversations_owner_idx
  ON public.assistant_conversations (workspace_id, user_id, last_used_at DESC);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;

-- Writes go through the server with the service role; users only list and
-- delete their own conversations in workspaces they still belong to.
DROP POLICY IF EXISTS "assistant_conversations_select" ON public.assistant_conversations;
CREATE POLICY "assistant_conversations_select" ON public.assistant_conversations
  FOR SELECT USING (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "assistant_conversations_delete" ON public.assistant_conversations;
CREATE POLICY "assistant_conversations_delete" ON public.assistant_conversations
  FOR DELETE USING (user_id = auth.uid() AND is_workspace_member(workspace_id));

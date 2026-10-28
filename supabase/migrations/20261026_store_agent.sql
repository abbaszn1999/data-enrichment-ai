-- Store Agent (Cursor SDK) — chats, runs, messages, files, approvals, audit
-- log, model catalog and per-user preferences.
--
-- Every row belongs to a workspace and is deleted with it. A chat is deleted
-- only when its owner deletes it; nothing expires on its own. Writes go through
-- the server with the service role (the agent service and the Next.js
-- gateway); browsers only read their own rows.
--
-- The Cursor SDK's own agent state (agents, runs, run events, checkpoints)
-- lives in separate tables added with the custom agent store.

-- ─── Chats ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.store_agent_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  -- Cursor SDK agent id; set on the first run.
  cursor_agent_id TEXT UNIQUE,
  model_id TEXT NOT NULL DEFAULT 'composer-2.5',
  -- Cursor model params, e.g. [{"id":"fast","value":"false"}].
  model_params JSONB NOT NULL DEFAULT '[]'::jsonb,
  mode TEXT NOT NULL DEFAULT 'agent' CHECK (mode IN ('agent', 'plan')),
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'awaiting_approval', 'awaiting_answer', 'interrupted', 'error')),
  context_used INTEGER NOT NULL DEFAULT 0 CHECK (context_used >= 0),
  context_window INTEGER CHECK (context_window IS NULL OR context_window > 0),
  credits_total NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (credits_total >= 0),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_agent_chats_owner_idx
  ON public.store_agent_chats (workspace_id, user_id, last_activity_at DESC);

-- ─── Runs (one send → one run; billing lives here) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.store_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.store_agent_chats(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cursor_run_id TEXT,
  model_id TEXT NOT NULL,
  model_params JSONB NOT NULL DEFAULT '[]'::jsonb,
  mode TEXT NOT NULL DEFAULT 'agent' CHECK (mode IN ('agent', 'plan')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'finished', 'cancelled', 'error', 'interrupted')),
  error TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  usd NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (usd >= 0),
  credits NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (credits >= 0),
  cost_source TEXT NOT NULL DEFAULT 'none' CHECK (cost_source IN ('billed', 'estimated', 'none')),
  charged BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS store_agent_runs_chat_idx
  ON public.store_agent_runs (chat_id, started_at DESC);

-- At most one live run per chat.
CREATE UNIQUE INDEX IF NOT EXISTS store_agent_runs_one_live_per_chat
  ON public.store_agent_runs (chat_id) WHERE status = 'running';

-- ─── Messages (display copy of the conversation) ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.store_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.store_agent_chats(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.store_agent_runs(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL DEFAULT '',
  -- Ordered blocks as they streamed: thinking, tool calls, todos, approvals,
  -- questions, files, summaries.
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_agent_messages_chat_idx
  ON public.store_agent_messages (chat_id, created_at);

-- ─── Files (agent output and user uploads, bytes in Storage) ─────────────────

CREATE TABLE IF NOT EXISTS public.store_agent_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.store_agent_chats(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.store_agent_runs(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  kind TEXT NOT NULL CHECK (kind IN ('report', 'plan', 'table', 'image', 'csv', 'upload', 'other')),
  -- Path inside the store-agent-files bucket: {workspaceId}/{chatId}/...
  storage_path TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0 CHECK (size >= 0),
  created_by TEXT NOT NULL CHECK (created_by IN ('agent', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_agent_files_chat_idx
  ON public.store_agent_files (chat_id, created_at);

-- ─── Approvals (store writes waiting for the user) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.store_agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES public.store_agent_chats(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.store_agent_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('write', 'delete', 'bulk')),
  summary TEXT NOT NULL DEFAULT '',
  operations JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_agent_approvals_run_idx
  ON public.store_agent_approvals (run_id, created_at);

-- ─── Audit log (every write the agent sent to the store) ─────────────────────

CREATE TABLE IF NOT EXISTS public.store_agent_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  chat_id UUID REFERENCES public.store_agent_chats(id) ON DELETE SET NULL,
  run_id UUID REFERENCES public.store_agent_runs(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approval_id UUID REFERENCES public.store_agent_approvals(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  scope TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  affected_ids TEXT[] NOT NULL DEFAULT '{}',
  ok BOOLEAN NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_agent_audit_log_workspace_idx
  ON public.store_agent_audit_log (workspace_id, created_at DESC);

-- ─── Model catalog (which Cursor models customers can pick) ──────────────────

CREATE TABLE IF NOT EXISTS public.store_agent_models (
  model_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  sort INTEGER NOT NULL DEFAULT 0,
  -- Params a new chat starts with; the picker offers every param Cursor lists.
  default_params JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS store_agent_models_one_default
  ON public.store_agent_models (is_default) WHERE is_default;

INSERT INTO public.store_agent_models (model_id, display_name, enabled, is_default, sort, default_params) VALUES
  ('composer-2.5', 'Composer 2.5', true, true, 10,
    '[{"id":"fast","value":"false"}]'),
  ('grok-4.7', 'Grok 4.7', true, false, 20,
    '[{"id":"context","value":"256k"},{"id":"reasoning_effort","value":"high"},{"id":"fast","value":"false"}]'),
  ('gemini-4-argon', 'Gemini 4 Argon', true, false, 30,
    '[{"id":"reasoning_effort","value":"medium"}]'),
  ('claude-sonnet-5-5', 'Claude Sonnet 5.5', true, false, 40,
    '[{"id":"context","value":"300k"},{"id":"reasoning_effort","value":"high"}]'),
  ('gpt-5.6-sol', 'GPT-5.6 Sol', true, false, 50,
    '[{"id":"context","value":"272k"},{"id":"reasoning","value":"medium"},{"id":"fast","value":"false"}]')
ON CONFLICT (model_id) DO NOTHING;

-- ─── Per-user preferences in a workspace ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.store_agent_prefs (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Apply store edits without asking. Deletes always ask.
  auto_run BOOLEAN NOT NULL DEFAULT false,
  model_id TEXT,
  model_params JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- ─── Row level security ──────────────────────────────────────────────────────

ALTER TABLE public.store_agent_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_agent_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_agent_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_agent_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_agent_prefs ENABLE ROW LEVEL SECURITY;

-- A user reads their own chats in workspaces they still belong to.
DROP POLICY IF EXISTS "store_agent_chats_select" ON public.store_agent_chats;
CREATE POLICY "store_agent_chats_select" ON public.store_agent_chats
  FOR SELECT USING (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "store_agent_runs_select" ON public.store_agent_runs;
CREATE POLICY "store_agent_runs_select" ON public.store_agent_runs
  FOR SELECT USING (user_id = auth.uid() AND is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "store_agent_messages_select" ON public.store_agent_messages;
CREATE POLICY "store_agent_messages_select" ON public.store_agent_messages
  FOR SELECT USING (
    is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.store_agent_chats c
      WHERE c.id = store_agent_messages.chat_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_agent_files_select" ON public.store_agent_files;
CREATE POLICY "store_agent_files_select" ON public.store_agent_files
  FOR SELECT USING (
    is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.store_agent_chats c
      WHERE c.id = store_agent_files.chat_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "store_agent_approvals_select" ON public.store_agent_approvals;
CREATE POLICY "store_agent_approvals_select" ON public.store_agent_approvals
  FOR SELECT USING (
    is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.store_agent_chats c
      WHERE c.id = store_agent_approvals.chat_id AND c.user_id = auth.uid()
    )
  );

-- The store's change history is visible to everyone in the workspace.
DROP POLICY IF EXISTS "store_agent_audit_log_select" ON public.store_agent_audit_log;
CREATE POLICY "store_agent_audit_log_select" ON public.store_agent_audit_log
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "store_agent_models_select" ON public.store_agent_models;
CREATE POLICY "store_agent_models_select" ON public.store_agent_models
  FOR SELECT TO authenticated USING (enabled);

DROP POLICY IF EXISTS "store_agent_prefs_select" ON public.store_agent_prefs;
CREATE POLICY "store_agent_prefs_select" ON public.store_agent_prefs
  FOR SELECT USING (user_id = auth.uid() AND is_workspace_member(workspace_id));

-- ─── Storage: private bucket for the SDK's checkpoint blobs ──────────────────
-- Service role only (no policies). Chat files have their own bucket
-- (20261026_store_agent_files_bucket.sql).

INSERT INTO storage.buckets (id, name, public)
VALUES ('agent-store', 'agent-store', false)
ON CONFLICT (id) DO NOTHING;

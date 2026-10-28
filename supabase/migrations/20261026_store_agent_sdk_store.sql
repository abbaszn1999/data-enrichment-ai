-- Cursor SDK agent state for the Store Agent (the custom LocalAgentStore).
--
-- The SDK owns these documents; we persist them unchanged in `doc`. Columns
-- next to it exist only to look rows up. Checkpoint blobs live in the private
-- `agent-store` Storage bucket under {agentId}/{blobId}.
--
-- When a workspace is deleted its agents keep their rows with workspace_id set
-- to NULL, so the agent service can still find and delete their checkpoint
-- blobs (Storage has no cascade); the service sweeps those rows.

CREATE TABLE IF NOT EXISTS public.agent_store_agents (
  agent_id TEXT PRIMARY KEY,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  cwd TEXT NOT NULL,
  doc JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_store_agents_cwd_idx
  ON public.agent_store_agents (cwd, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_store_agents_orphan_idx
  ON public.agent_store_agents (agent_id) WHERE workspace_id IS NULL;

CREATE TABLE IF NOT EXISTS public.agent_store_runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES public.agent_store_agents(agent_id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  doc JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_store_runs_agent_idx
  ON public.agent_store_runs (agent_id, turn_number, run_id);

CREATE TABLE IF NOT EXISTS public.agent_store_run_events (
  run_id TEXT NOT NULL REFERENCES public.agent_store_runs(run_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  payload_ref TEXT,
  idempotency_key TEXT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

-- Service role only: no policies, so browsers can never read agent internals.
ALTER TABLE public.agent_store_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_store_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_store_run_events ENABLE ROW LEVEL SECURITY;

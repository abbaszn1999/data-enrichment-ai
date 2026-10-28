-- Store Agent: checkpoint blobs of the Cursor SDK agents, in Postgres.
-- A chat's memory is hundreds of small blobs that the SDK reads one by one at
-- the start of every message; as Storage objects that was one HTTP request per
-- blob (minutes on a long chat). In a table they load in a few queries.
-- Blobs written before this table remain in the agent-store bucket and are
-- moved here the first time their chat is opened.

create table if not exists public.agent_store_blobs (
  agent_id text not null,
  blob_id text not null,
  -- "gz:" + base64 of the gzip-compressed blob (PostgREST carries text more simply than bytea)
  data text not null,
  size integer not null,
  created_at timestamptz not null default now(),
  primary key (agent_id, blob_id)
);

-- Service-role access only, like the other agent_store_* tables.
alter table public.agent_store_blobs enable row level security;

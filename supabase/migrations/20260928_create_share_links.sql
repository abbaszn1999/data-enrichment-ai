-- Public share links for Catalog, Gallery and Visualizer sessions.
-- Already live on the main database (applied through the Supabase MCP); this
-- file records it so a fresh or local database can be brought in line.
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  resource_type text not null check (resource_type in ('catalog', 'gallery', 'visualizer')),
  resource_id uuid not null,
  token text not null unique,
  created_by uuid not null references auth.users(id),
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists share_links_token_idx
  on public.share_links (token) where revoked_at is null;
create index if not exists share_links_workspace_idx
  on public.share_links (workspace_id);
create unique index if not exists share_links_active_resource_idx
  on public.share_links (workspace_id, resource_type, resource_id) where revoked_at is null;

alter table public.share_links enable row level security;

drop policy if exists share_links_select on public.share_links;
create policy share_links_select on public.share_links
  for select using (is_workspace_member(workspace_id));

drop policy if exists share_links_insert on public.share_links;
create policy share_links_insert on public.share_links
  for insert with check (is_workspace_member(workspace_id, 'editor'::text));

drop policy if exists share_links_update on public.share_links;
create policy share_links_update on public.share_links
  for update using (is_workspace_member(workspace_id, 'editor'::text))
  with check (is_workspace_member(workspace_id, 'editor'::text));

drop policy if exists share_links_delete on public.share_links;
create policy share_links_delete on public.share_links
  for delete using (is_workspace_member(workspace_id, 'editor'::text));

-- Catalog Intelligence presets: a named set of columns + their custom
-- instructions + sources + language, reusable across sheets of a workspace.
-- Applied via the Supabase MCP as migration "catalog_presets".
create table if not exists public.catalog_presets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null default 'product' check (kind in ('product','plp')),
  name text not null check (length(btrim(name)) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalog_presets_workspace_kind_name_key
  on public.catalog_presets (workspace_id, kind, lower(btrim(name)));
create index if not exists catalog_presets_workspace_idx
  on public.catalog_presets (workspace_id, kind, updated_at desc);

alter table public.catalog_presets enable row level security;

create policy catalog_presets_member_select on public.catalog_presets
  for select to authenticated
  using (exists (
    select 1 from public.workspace_members m
    where m.workspace_id = catalog_presets.workspace_id and m.user_id = (select auth.uid())
  ));

-- Backfill from the old per-workspace JSON list (newest first there, so keep the first of each name).
insert into public.catalog_presets (id, workspace_id, kind, name, payload, created_at, updated_at)
select
  case when p->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p->>'id')::uuid else gen_random_uuid() end,
  w.id,
  case when p->>'kind' = 'plp' then 'plp' else 'product' end,
  left(btrim(coalesce(nullif(p->>'name',''), 'AI Setting')), 80),
  coalesce(p->'settings', '{}'::jsonb),
  coalesce(nullif(p->>'createdAt','')::timestamptz, now()),
  coalesce(nullif(p->>'updatedAt','')::timestamptz, now())
from public.workspaces w,
  jsonb_array_elements(case when jsonb_typeof(w.enrichment_presets) = 'array' then w.enrichment_presets else '[]'::jsonb end) as p
on conflict do nothing;

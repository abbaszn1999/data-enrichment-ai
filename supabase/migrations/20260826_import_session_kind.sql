-- Catalog Intelligence sessions can enrich products or PLP (category) pages.
-- Existing sessions predate the split and are all product sessions.

alter table import_sessions
  add column if not exists kind text not null default 'product';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_sessions_kind_check'
  ) then
    alter table import_sessions
      add constraint import_sessions_kind_check
      check (kind in ('product', 'plp'));
  end if;
end $$;

create index if not exists import_sessions_workspace_kind_idx
  on import_sessions (workspace_id, kind);

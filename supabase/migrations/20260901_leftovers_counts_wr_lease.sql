-- Category product counts (Issue 2.2) and reclaimable WR build leases (Issue 11.2).

create or replace function public.category_product_counts(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(cid, cnt), '{}'::jsonb)
  from (
    select meta->>'categoryId' as cid, count(*)::int as cnt
    from public.workspace_products
    where workspace_id = p_workspace_id
      and nullif(meta->>'categoryId', '') is not null
    group by 1
  ) s;
$$;

revoke all on function public.category_product_counts(uuid) from public;
grant execute on function public.category_product_counts(uuid) to service_role;

alter table public.wr_projects
  add column if not exists build_lease_by uuid;

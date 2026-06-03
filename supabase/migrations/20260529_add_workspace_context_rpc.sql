-- Get workspace context (membership + subscription/plan + integration) in one call
-- Returns NULL-able fields; caller should enforce membership/active subscription.

create or replace function public.get_workspace_context_v1(
  p_workspace_id uuid,
  p_user_id uuid
)
returns table (
  membership_role text,
  owner_id uuid,
  subscription jsonb,
  plan jsonb,
  integration jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    m.role as membership_role,
    w.owner_id,
    to_jsonb(us.*) as subscription,
    to_jsonb(sp.*) as plan,
    to_jsonb(wi.*) as integration
  from public.workspaces w
  left join public.workspace_members m
    on m.workspace_id = w.id and m.user_id = p_user_id
  left join public.user_subscriptions us
    on us.user_id = w.owner_id
  left join public.subscription_plans sp
    on sp.id = us.plan_id
  left join public.workspace_integrations wi
    on wi.workspace_id = w.id
  where w.id = p_workspace_id;
end;
$$;

comment on function public.get_workspace_context_v1(uuid, uuid)
  is 'Fetch membership role, owner_id, subscription+plan, and integration for a workspace/user in one round trip.';

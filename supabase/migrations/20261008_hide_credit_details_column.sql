-- details holds model ids and provider costs. The app reads this table only
-- with the service role; signed-in users keep every other column.
revoke select on public.credit_transactions from anon, authenticated;
grant select (id, workspace_id, user_id, operation, credits_used, entity_type, entity_id, created_at)
  on public.credit_transactions to authenticated;

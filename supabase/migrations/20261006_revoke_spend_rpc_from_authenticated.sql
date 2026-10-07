-- SEC-08: these SECURITY DEFINER RPCs filter only by the caller-supplied
-- workspace id. Every server caller uses the service role, so remove direct
-- access for browser roles. (Supabase default privileges grant anon and
-- authenticated explicitly, so REVOKE ... FROM PUBLIC alone is not enough.)
REVOKE EXECUTE ON FUNCTION public.credit_usage_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wallet_spend_summaries(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fa_wallet_spend_summaries(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.category_product_counts(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.credit_usage_totals(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_spend_summaries(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fa_wallet_spend_summaries(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.category_product_counts(uuid) TO service_role;

-- Finding S-6: live policy audit. Run against local and deploy.
-- Flags:
--   1. USING/WITH CHECK = true for non-service-role, non-catalog tables
--   2. RLS enabled with zero policies (deny-all — usually an oversight)
--   3. Client-role policies whose predicate has no tenant/identity key

-- Open predicates (must be empty after 20260901_rls_invite_scope)
SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (coalesce(qual, '') = 'true' OR coalesce(with_check, '') = 'true')
  AND roles::text NOT LIKE '%service_role%'
  AND tablename <> 'subscription_plans';

-- RLS on, zero policies
SELECT c.relname AS table,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity
  AND NOT EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
  );

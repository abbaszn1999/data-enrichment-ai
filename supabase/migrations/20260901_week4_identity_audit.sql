-- Week 4: Catalog Intelligence / Store Assistant identifiers, credential
-- fingerprint, append-only security_audit_logs. Applied to local and deploy.

-- 1. Rename import_sessions → catalog_sessions (policies travel with the table).
ALTER TABLE IF EXISTS public.import_sessions RENAME TO catalog_sessions;

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.catalog_sessions') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.catalog_sessions'::regclass
      AND conname LIKE 'import_sessions%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.catalog_sessions RENAME CONSTRAINT %I TO %I',
      r.conname,
      replace(r.conname, 'import_sessions', 'catalog_sessions')
    );
  END LOOP;

  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'catalog_sessions'
      AND indexname LIKE 'import_sessions%'
  LOOP
    EXECUTE format(
      'ALTER INDEX public.%I RENAME TO %I',
      r.indexname,
      replace(r.indexname, 'import_sessions', 'catalog_sessions')
    );
  END LOOP;
END $$;

-- 2. Credit ledger: rewrite operations while data is still disposable.
ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_operation_check;

UPDATE public.credit_transactions
SET operation = 'catalog_intelligence'
WHERE operation = 'ai_enrichment';

UPDATE public.credit_transactions
SET
  operation = 'store_assistant',
  entity_type = CASE
    WHEN entity_type = 'sync_agent' THEN 'store_assistant'
    ELSE entity_type
  END
WHERE operation = 'sync_agent';

UPDATE public.credit_transactions
SET entity_type = 'store_assistant'
WHERE entity_type = 'sync_agent';

UPDATE public.credit_transactions
SET entity_type = 'catalog_row'
WHERE entity_type = 'import_row';

UPDATE public.credit_transactions
SET entity_type = 'catalog_plp_row'
WHERE entity_type = 'import_plp_row';

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_operation_check
  CHECK (operation = ANY (ARRAY[
    'catalog_intelligence'::text,
    'ai_image_search'::text,
    'ai_column_mapping'::text,
    'ai_category_suggest'::text,
    'ai_function'::text,
    'store_assistant'::text,
    'image_classification'::text,
    'gallery_google'::text,
    'gallery_ai'::text,
    'visualizer_description'::text,
    'visualizer_images'::text,
    'credit_topup'::text,
    'monthly_reset'::text
  ]));

-- 3. Wallet modules. 'Sync' was Growth Sync's ledger key, not Store Assistant
-- (Store Assistant bills credit_transactions). Collapse Market Research dupes.
UPDATE public.wallet_transactions
SET module = 'growth-sync'
WHERE module = 'Sync';

UPDATE public.wallet_transactions
SET module = 'market-research'
WHERE module IN ('Market Research', 'market-research');

-- 4. Display fingerprint so settings never needs decrypted secrets.
ALTER TABLE public.workspace_integrations
  ADD COLUMN IF NOT EXISTS credential_fingerprint text;

-- 5. Append-only security audit log (S-4). workspace_id is not an FK so an
-- erasure receipt survives tenant purge.
CREATE TABLE IF NOT EXISTS public.security_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  actor_id uuid,
  action text NOT NULL,
  target_id text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  module text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_audit_logs_workspace_created_idx
  ON public.security_audit_logs (workspace_id, created_at DESC);

ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS security_audit_logs_service_insert ON public.security_audit_logs;
CREATE POLICY security_audit_logs_service_insert
  ON public.security_audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS security_audit_logs_service_select ON public.security_audit_logs;
CREATE POLICY security_audit_logs_service_select
  ON public.security_audit_logs
  FOR SELECT
  TO service_role
  USING (true);

REVOKE ALL ON public.security_audit_logs FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON public.security_audit_logs TO service_role;
REVOKE UPDATE, DELETE ON public.security_audit_logs FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.security_audit_logs_deny_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'security_audit_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS security_audit_logs_no_update ON public.security_audit_logs;
CREATE TRIGGER security_audit_logs_no_update
  BEFORE UPDATE ON public.security_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.security_audit_logs_deny_mutation();

DROP TRIGGER IF EXISTS security_audit_logs_no_delete ON public.security_audit_logs;
CREATE TRIGGER security_audit_logs_no_delete
  BEFORE DELETE ON public.security_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.security_audit_logs_deny_mutation();

-- 6. Admin usage view follows the renamed table.
CREATE OR REPLACE FUNCTION public.admin_workspace_usage()
RETURNS TABLE (
  workspace_id uuid,
  storage_bytes bigint,
  object_count bigint,
  db_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH storage_usage AS (
    SELECT
      w.id AS workspace_id,
      COALESCE(SUM(
        CASE
          WHEN (o.metadata->>'size') ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint
          ELSE 0
        END
      ), 0)::bigint AS storage_bytes,
      COUNT(o.id)::bigint AS object_count
    FROM public.workspaces w
    LEFT JOIN storage.objects o
      ON o.bucket_id = 'workspace-files'
     AND split_part(o.name, '/', 1) = w.id::text
    GROUP BY w.id
  ),
  db_usage AS (
    SELECT workspace_id, SUM(bytes)::bigint AS db_bytes
    FROM (
      SELECT id AS workspace_id, (pg_column_size(t) + 24)::bigint AS bytes FROM public.workspaces t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.activity_log t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.credit_transactions t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.gallery_sessions t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.gs_activity t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.gs_quotas t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.gs_rules t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.gs_runs t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.image_classification_sessions t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.catalog_sessions t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.job_runs t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.mr_extracts t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.mr_projects t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.mr_runs t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.mr_workspace_prefs t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.notifications t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.sync_agent_traces t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.visualizer_sessions t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.wallet_transactions t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.workspace_integrations t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.workspace_invites t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.workspace_members t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.workspace_wallets t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.wr_projects t
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.security_audit_logs t
    ) rows
    GROUP BY 1
  )
  SELECT
    s.workspace_id,
    s.storage_bytes,
    s.object_count,
    COALESCE(d.db_bytes, 0)::bigint AS db_bytes
  FROM storage_usage s
  LEFT JOIN db_usage d ON d.workspace_id = s.workspace_id;
$$;

REVOKE ALL ON FUNCTION public.admin_workspace_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_workspace_usage() TO service_role;

-- Admin console: files (Storage) + row-data estimate (Postgres) per workspace.
-- Storage is exact for bucket workspace-files paths {workspaceId}/...
-- db_bytes is heap-row size (pg_column_size + 24), not on-disk including indexes/bloat.
-- Service role only. Product data lives in Storage; Postgres is metadata.

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
      UNION ALL SELECT workspace_id, (pg_column_size(t) + 24)::bigint FROM public.import_sessions t
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

COMMENT ON FUNCTION public.admin_workspace_usage() IS
  'Platform admin: Storage bytes/objects in workspace-files plus Postgres row-size estimate per workspace. Service role only.';

REVOKE ALL ON FUNCTION public.admin_workspace_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_workspace_usage() TO service_role;

-- workspace-files policies were bucket-only and granted to PUBLIC, so anyone
-- holding the public anon key could list/read/overwrite/delete every tenant's
-- files. Every object path starts with "<workspace_id>/". Restrict all browser
-- access to signed-in members of that workspace. Server code uses service_role
-- and bypasses these policies.

CREATE OR REPLACE FUNCTION public.storage_path_workspace_member(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_workspace_member(split_part(p_name, '/', 1)::uuid, 'viewer')
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.storage_path_workspace_member(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_path_workspace_member(text) TO authenticated, service_role;

DROP POLICY IF EXISTS workspace_files_select ON storage.objects;
DROP POLICY IF EXISTS workspace_files_insert ON storage.objects;
DROP POLICY IF EXISTS workspace_files_update ON storage.objects;
DROP POLICY IF EXISTS workspace_files_delete ON storage.objects;

CREATE POLICY workspace_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'workspace-files' AND public.storage_path_workspace_member(name));

CREATE POLICY workspace_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workspace-files' AND public.storage_path_workspace_member(name));

CREATE POLICY workspace_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'workspace-files' AND public.storage_path_workspace_member(name))
  WITH CHECK (bucket_id = 'workspace-files' AND public.storage_path_workspace_member(name));

CREATE POLICY workspace_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'workspace-files' AND public.storage_path_workspace_member(name));

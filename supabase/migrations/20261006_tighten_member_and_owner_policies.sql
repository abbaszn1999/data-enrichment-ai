-- 1) Any member (even viewer) could INSERT fake rows into credit_transactions
--    straight through PostgREST. All real inserts run as service_role.
DROP POLICY IF EXISTS credits_insert ON public.credit_transactions;

-- 2) A workspace admin could, through PostgREST, insert/promote a member to
--    'owner', or demote/remove the real owner. Owner rows are managed only by
--    server routes (service_role).
DROP POLICY IF EXISTS members_insert ON public.workspace_members;
CREATE POLICY members_insert ON public.workspace_members
  FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id, 'admin') AND role <> 'owner');

DROP POLICY IF EXISTS members_update ON public.workspace_members;
CREATE POLICY members_update ON public.workspace_members
  FOR UPDATE
  USING (
    public.is_workspace_member(workspace_id, 'admin')
    AND user_id <> (SELECT auth.uid())
    AND role <> 'owner'
  )
  WITH CHECK (
    public.is_workspace_member(workspace_id, 'admin')
    AND user_id <> (SELECT auth.uid())
    AND role <> 'owner'
  );

DROP POLICY IF EXISTS members_delete ON public.workspace_members;
CREATE POLICY members_delete ON public.workspace_members
  FOR DELETE
  USING (
    public.is_workspace_member(workspace_id, 'admin')
    AND user_id <> (SELECT auth.uid())
    AND role <> 'owner'
  );

-- 3) workspaces_update lets an admin update the row; nothing stopped them from
--    setting owner_id to themselves (then deleting the workspace). Browser
--    roles may still edit name/description/etc.
CREATE OR REPLACE FUNCTION public.workspaces_protect_owner_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND (
       NEW.id IS DISTINCT FROM OLD.id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  ) THEN
    RAISE EXCEPTION 'owner_id, id and deleted_at can only be changed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_protect_owner_columns ON public.workspaces;
CREATE TRIGGER workspaces_protect_owner_columns
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_protect_owner_columns();

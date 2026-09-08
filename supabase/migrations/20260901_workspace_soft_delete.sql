-- Two-phase tenant deletion (Finding S-5).
-- deleted_at is the authorization boundary: once set, the workspace is
-- invisible. Storage is purged and verified before the row is removed.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS workspaces_deleted_at_idx
  ON public.workspaces (deleted_at)
  WHERE deleted_at IS NOT NULL;

DROP POLICY IF EXISTS "workspaces_public_read" ON public.workspaces;
CREATE POLICY "workspaces_public_read" ON public.workspaces
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      is_workspace_member(id)
      OR (
        id IN (
          SELECT workspace_invites.workspace_id
          FROM workspace_invites
          WHERE workspace_invites.accepted_at IS NULL
            AND workspace_invites.expires_at > now()
            AND lower(workspace_invites.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.get_workspace_context_v1(
  p_workspace_id uuid,
  p_user_id uuid
)
RETURNS TABLE (
  membership_role text,
  owner_id uuid,
  subscription jsonb,
  plan jsonb,
  integration jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.role AS membership_role,
    w.owner_id,
    to_jsonb(us.*) AS subscription,
    to_jsonb(sp.*) AS plan,
    to_jsonb(wi.*) AS integration
  FROM public.workspaces w
  LEFT JOIN public.workspace_members m
    ON m.workspace_id = w.id AND m.user_id = p_user_id
  LEFT JOIN public.user_subscriptions us
    ON us.user_id = w.owner_id
  LEFT JOIN public.subscription_plans sp
    ON sp.id = us.plan_id
  LEFT JOIN public.workspace_integrations wi
    ON wi.workspace_id = w.id
  WHERE w.id = p_workspace_id
    AND w.deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_context_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_context_v1(uuid, uuid)
  TO service_role;

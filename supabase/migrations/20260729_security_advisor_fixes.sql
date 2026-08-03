-- Resolve actionable database-advisor findings without changing app flows.

ALTER FUNCTION public.set_gallery_sessions_updated_at()
  SET search_path = public;
ALTER FUNCTION public.set_image_classification_sessions_updated_at()
  SET search_path = public;

CREATE INDEX IF NOT EXISTS idx_gallery_sessions_created_by
  ON public.gallery_sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
  ON public.workspace_members(user_id);

-- These RPCs are used only through the server-side service-role client.
REVOKE ALL ON FUNCTION public.try_advisory_lock_text(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advisory_unlock_text(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_workspace_context_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.try_advisory_lock_text(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.advisory_unlock_text(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_context_v1(uuid, uuid) TO service_role;

-- Anonymous callers cannot be workspace members. Authenticated execution is
-- retained because RLS policies call this helper.
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, text)
  TO authenticated, service_role;

-- Invitation acceptance is performed by a validated server route using the
-- service role. Direct table updates are limited to workspace admins.
DROP POLICY IF EXISTS invites_update ON public.workspace_invites;
CREATE POLICY invites_update ON public.workspace_invites
  FOR UPDATE
  USING (public.is_workspace_member(workspace_id, 'admin'))
  WITH CHECK (public.is_workspace_member(workspace_id, 'admin'));

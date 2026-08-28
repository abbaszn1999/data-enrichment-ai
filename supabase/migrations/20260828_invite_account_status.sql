-- Service-role helpers so invite flows can tell a completed account from an
-- OTP user created only to deliver the invite email.

CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_user_has_password(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT COALESCE(
    (
      SELECT encrypted_password IS NOT NULL AND length(encrypted_password) > 0
      FROM auth.users
      WHERE id = p_user_id
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.auth_user_id_by_email(text) IS
  'Service role: auth.users id for an email, if any.';
COMMENT ON FUNCTION public.auth_user_has_password(uuid) IS
  'Service role: whether the auth user has a password (not invite/OTP-only).';

REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;

REVOKE ALL ON FUNCTION public.auth_user_has_password(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_has_password(uuid) TO service_role;

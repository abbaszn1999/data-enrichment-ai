-- Finding S-6: tenant-scope invite and profile reads.
-- Pending invites were readable by any authenticated role (token harvest).
-- Profiles were world-readable.

DROP POLICY IF EXISTS "invites_select" ON public.workspace_invites;
CREATE POLICY "invites_select" ON public.workspace_invites
  FOR SELECT
  USING (
    is_workspace_member(workspace_id)
    OR (
      accepted_at IS NULL
      AND expires_at > now()
      AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT
  USING (
    id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members mine
      JOIN public.workspace_members theirs
        ON theirs.workspace_id = mine.workspace_id
      WHERE mine.user_id = (SELECT auth.uid())
        AND theirs.user_id = profiles.id
    )
  );

-- Explicit deny-all for a table that previously had RLS on and zero policies.
DROP POLICY IF EXISTS "wallet_stripe_customers_no_client" ON public.wallet_stripe_customers;
CREATE POLICY "wallet_stripe_customers_no_client" ON public.wallet_stripe_customers
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

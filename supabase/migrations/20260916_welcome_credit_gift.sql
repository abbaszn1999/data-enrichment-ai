-- First paid Growth/Pro subscription: 5,000 bonus credits, claimable for 30 days.
-- Clock is first_paid_at (Stripe activation), never the trial row's created_at.

ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS first_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcome_gift_claimed_at timestamptz;

-- Anyone who already has a Stripe subscription is treated as past the window
-- so current customers are not given a surprise 5,000 credits.
UPDATE public.user_subscriptions
SET first_paid_at = NOW() - interval '31 days'
WHERE stripe_subscription_id IS NOT NULL
  AND first_paid_at IS NULL;

CREATE INDEX IF NOT EXISTS user_subscriptions_welcome_gift_idx
  ON public.user_subscriptions (user_id)
  WHERE welcome_gift_claimed_at IS NULL
    AND first_paid_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_welcome_credit_gift(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_bonus numeric(12,3);
BEGIN
  UPDATE public.user_subscriptions us
  SET
    bonus_credits = COALESCE(us.bonus_credits, 0) + 5000,
    welcome_gift_claimed_at = NOW(),
    updated_at = NOW()
  FROM public.subscription_plans sp
  WHERE us.user_id = p_user_id
    AND us.plan_id = sp.id
    AND sp.name IN ('growth', 'pro')
    AND us.status = 'active'
    AND us.stripe_subscription_id IS NOT NULL
    AND us.first_paid_at IS NOT NULL
    AND us.first_paid_at > NOW() - interval '30 days'
    AND us.welcome_gift_claimed_at IS NULL
  RETURNING us.bonus_credits INTO new_bonus;

  IF new_bonus IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.credit_purchases (
    user_id,
    credits,
    amount_paid,
    status
  ) VALUES (
    p_user_id,
    5000,
    0,
    'completed'
  );

  RETURN new_bonus;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_welcome_credit_gift(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_welcome_credit_gift(uuid) TO service_role;

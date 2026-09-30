-- Billing hardening:
-- 1. deduct_user_credits checks its idempotency key only after locking the
--    subscription row, so two concurrent retries of the same charge can never
--    both pass the duplicate check.
-- 2. grant_purchased_credits adds purchased credits atomically and at most once
--    per Stripe Checkout session (the Stripe webhook is delivered at least once).
-- 3. Unique indexes that let the webhook claim events and log purchases safely.
--    Each is skipped with a notice if existing rows would violate it.

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS credit_purchases_checkout_session_idx
    ON public.credit_purchases (stripe_checkout_session_id)
    WHERE stripe_checkout_session_id IS NOT NULL;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'credit_purchases has duplicate checkout sessions; unique index skipped';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_id_unique_idx
    ON public.webhook_events (id);
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'webhook_events has duplicate ids; unique index skipped';
END $$;

CREATE OR REPLACE FUNCTION public.grant_purchased_credits(
  p_user_id             uuid,
  p_credits             integer,
  p_amount_paid         numeric,
  p_checkout_session_id text,
  p_payment_intent_id   text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_bonus numeric;
BEGIN
  IF p_user_id IS NULL OR p_credits IS NULL OR p_credits <= 0
     OR NULLIF(BTRIM(COALESCE(p_checkout_session_id, '')), '') IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid credit purchase');
  END IF;

  PERFORM 1
  FROM public.user_subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'No subscription found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.credit_purchases cp
    WHERE cp.stripe_checkout_session_id = p_checkout_session_id
  ) THEN
    RETURN json_build_object('success', true, 'duplicate', true);
  END IF;

  UPDATE public.user_subscriptions
  SET bonus_credits = COALESCE(bonus_credits, 0) + p_credits,
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING bonus_credits INTO new_bonus;

  INSERT INTO public.credit_purchases (
    user_id,
    credits,
    amount_paid,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    status
  ) VALUES (
    p_user_id,
    p_credits,
    COALESCE(p_amount_paid, 0),
    p_checkout_session_id,
    p_payment_intent_id,
    'completed'
  );

  RETURN json_build_object('success', true, 'duplicate', false, 'bonusCredits', new_bonus);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_purchased_credits(uuid, integer, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_purchased_credits(uuid, integer, numeric, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.deduct_user_credits(
  p_user_id      uuid,
  p_amount       numeric,
  p_workspace_id uuid,
  p_operation    text,
  p_uid          uuid,
  p_entity_type  text    DEFAULT NULL,
  p_entity_id    uuid    DEFAULT NULL,
  p_details      jsonb   DEFAULT '{}'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub_record         RECORD;
  included_credits   numeric(12,3);
  monthly_remaining  numeric(12,3);
  bonus_remaining    numeric(12,3);
  from_monthly       numeric(12,3);
  from_bonus         numeric(12,3);
  new_credits_used   numeric(12,3);
  new_bonus_credits  numeric(12,3);
  total_remaining    numeric(12,3);
  idempotency_key    text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Amount must be greater than zero and within allowed limits',
      'remaining', 0
    );
  END IF;

  IF p_workspace_id IS NULL OR p_user_id IS NULL OR p_uid IS NULL
     OR NULLIF(BTRIM(p_operation), '') IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Missing required deduction context',
      'remaining', 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = p_workspace_id
      AND w.owner_id = p_user_id
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Workspace billing owner mismatch',
      'remaining', 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_uid
      AND wm.role IN ('owner', 'admin', 'editor')
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Actor is not allowed to spend workspace credits',
      'remaining', 0
    );
  END IF;

  SELECT
    us.credits_used,
    us.bonus_credits,
    us.billing_cycle,
    us.status,
    us.trial_end,
    sp.monthly_ai_credits
  INTO sub_record
  FROM public.user_subscriptions us
  LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id
  FOR UPDATE OF us;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No active subscription found',
      'remaining', 0
    );
  END IF;

  idempotency_key := NULLIF(BTRIM(COALESCE(p_details ->> 'idempotencyKey', '')), '');
  IF idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.credit_transactions ct
    WHERE ct.workspace_id = p_workspace_id
      AND ct.operation = p_operation
      AND ct.details ->> 'idempotencyKey' = idempotency_key
  ) THEN
    RETURN json_build_object(
      'success', true,
      'duplicate', true,
      'remaining', NULL
    );
  END IF;

  IF sub_record.status = 'trialing'
     AND sub_record.trial_end IS NOT NULL
     AND sub_record.trial_end <= NOW() THEN
    UPDATE public.user_subscriptions
    SET status = 'expired', updated_at = NOW()
    WHERE user_id = p_user_id;
    RETURN json_build_object(
      'success', false,
      'error', 'No active subscription found',
      'remaining', 0
    );
  END IF;

  IF sub_record.status NOT IN ('active', 'trialing') THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No active subscription found',
      'remaining', 0
    );
  END IF;

  included_credits := ROUND(
    CASE
      WHEN sub_record.billing_cycle = 'yearly'
        THEN COALESCE(sub_record.monthly_ai_credits, 0)::numeric * 12
      ELSE COALESCE(sub_record.monthly_ai_credits, 0)::numeric
    END,
    3
  );

  monthly_remaining := GREATEST(
    0::numeric,
    ROUND(included_credits - COALESCE(sub_record.credits_used, 0)::numeric, 3)
  );
  bonus_remaining := GREATEST(
    0::numeric,
    ROUND(COALESCE(sub_record.bonus_credits, 0)::numeric, 3)
  );

  IF monthly_remaining + bonus_remaining < p_amount THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient credits',
      'remaining', ROUND(monthly_remaining + bonus_remaining, 3)
    );
  END IF;

  from_monthly := LEAST(monthly_remaining, p_amount);
  from_bonus := ROUND(p_amount - from_monthly, 3);
  new_credits_used := ROUND(
    COALESCE(sub_record.credits_used, 0)::numeric + from_monthly,
    3
  );
  new_bonus_credits := ROUND(
    GREATEST(
      0::numeric,
      COALESCE(sub_record.bonus_credits, 0)::numeric - from_bonus
    ),
    3
  );

  UPDATE public.user_subscriptions
  SET
    credits_used = new_credits_used,
    bonus_credits = new_bonus_credits,
    updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (
    workspace_id,
    user_id,
    operation,
    credits_used,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    p_workspace_id,
    p_uid,
    p_operation,
    ROUND(p_amount, 3),
    p_entity_type,
    p_entity_id,
    COALESCE(p_details, '{}'::jsonb)
  );

  total_remaining := ROUND(
    GREATEST(0::numeric, included_credits - new_credits_used)
      + new_bonus_credits,
    3
  );

  RETURN json_build_object(
    'success', true,
    'remaining', total_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_user_credits(
  uuid, numeric, uuid, text, uuid, text, uuid, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.deduct_user_credits(
  uuid, numeric, uuid, text, uuid, text, uuid, jsonb
) TO service_role;

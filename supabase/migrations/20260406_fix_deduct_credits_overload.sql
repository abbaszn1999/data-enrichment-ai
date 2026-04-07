-- Fix: "300 Multiple Choices" caused by multiple overloads of deduct_user_credits.
-- This drops ALL overloads and recreates a single clean numeric version.

-- Step 1: Drop EVERY overload dynamically (handles any signature variant)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM   pg_proc
    WHERE  proname        = 'deduct_user_credits'
    AND    pronamespace   = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END;
$$;

-- Step 2: Recreate with a single, unambiguous numeric version
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
BEGIN
  SELECT
    us.credits_used,
    us.bonus_credits,
    us.billing_cycle,
    sp.monthly_ai_credits
  INTO sub_record
  FROM public.user_subscriptions us
  LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id
  FOR UPDATE OF us;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error',   'No subscription found',
      'remaining', 0
    );
  END IF;

  included_credits := ROUND(
    CASE
      WHEN sub_record.billing_cycle = 'yearly' THEN COALESCE(sub_record.monthly_ai_credits, 0)::numeric * 12
      ELSE COALESCE(sub_record.monthly_ai_credits, 0)::numeric
    END,
    3
  );

  monthly_remaining := GREATEST(
    0::numeric,
    ROUND(
      included_credits
      - COALESCE(sub_record.credits_used, 0)::numeric,
      3
    )
  );
  bonus_remaining := GREATEST(
    0::numeric,
    ROUND(COALESCE(sub_record.bonus_credits, 0)::numeric, 3)
  );

  IF monthly_remaining + bonus_remaining < p_amount THEN
    RETURN json_build_object(
      'success',   false,
      'error',     'Insufficient credits',
      'remaining', ROUND(monthly_remaining + bonus_remaining, 3)
    );
  END IF;

  from_monthly      := LEAST(monthly_remaining, p_amount);
  from_bonus        := ROUND(p_amount - from_monthly, 3);
  new_credits_used  := ROUND(COALESCE(sub_record.credits_used,  0)::numeric + from_monthly, 3);
  new_bonus_credits := ROUND(
    GREATEST(0::numeric, COALESCE(sub_record.bonus_credits, 0)::numeric - from_bonus),
    3
  );

  UPDATE public.user_subscriptions
  SET
    credits_used  = new_credits_used,
    bonus_credits = new_bonus_credits,
    updated_at    = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_transactions (
    workspace_id, user_id, operation,
    credits_used, entity_type, entity_id, details
  ) VALUES (
    p_workspace_id, p_uid, p_operation,
    ROUND(p_amount, 3),
    p_entity_type, p_entity_id,
    COALESCE(p_details, '{}'::jsonb)
  );

  total_remaining := ROUND(
    GREATEST(
      0::numeric,
      included_credits - new_credits_used
    ) + new_bonus_credits,
    3
  );

  RETURN json_build_object(
    'success',   true,
    'remaining', total_remaining
  );
END;
$$;

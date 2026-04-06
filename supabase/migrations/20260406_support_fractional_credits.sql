ALTER TABLE public.user_subscriptions
  ALTER COLUMN credits_used TYPE numeric(12,3) USING ROUND(COALESCE(credits_used, 0)::numeric, 3),
  ALTER COLUMN credits_used SET DEFAULT 0,
  ALTER COLUMN bonus_credits TYPE numeric(12,3) USING ROUND(COALESCE(bonus_credits, 0)::numeric, 3),
  ALTER COLUMN bonus_credits SET DEFAULT 0;

ALTER TABLE public.credit_transactions
  ALTER COLUMN credits_used TYPE numeric(12,3) USING ROUND(COALESCE(credits_used, 0)::numeric, 3),
  ALTER COLUMN credits_used SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public.deduct_user_credits(
  p_user_id uuid,
  p_amount numeric,
  p_workspace_id uuid,
  p_operation text,
  p_uid uuid,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub_record RECORD;
  monthly_remaining numeric(12,3);
  bonus_remaining numeric(12,3);
  from_monthly numeric(12,3);
  from_bonus numeric(12,3);
  new_credits_used numeric(12,3);
  new_bonus_credits numeric(12,3);
  total_remaining numeric(12,3);
BEGIN
  SELECT
    us.credits_used,
    us.bonus_credits,
    sp.monthly_ai_credits
  INTO sub_record
  FROM public.user_subscriptions us
  LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id
  FOR UPDATE OF us;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'No subscription found',
      'remaining', 0
    );
  END IF;

  monthly_remaining := GREATEST(
    0::numeric,
    ROUND(COALESCE(sub_record.monthly_ai_credits, 0)::numeric - COALESCE(sub_record.credits_used, 0)::numeric, 3)
  );
  bonus_remaining := GREATEST(0::numeric, ROUND(COALESCE(sub_record.bonus_credits, 0)::numeric, 3));

  IF monthly_remaining + bonus_remaining < p_amount THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Insufficient credits',
      'remaining', ROUND(monthly_remaining + bonus_remaining, 3)
    );
  END IF;

  from_monthly := LEAST(monthly_remaining, p_amount);
  from_bonus := ROUND(p_amount - from_monthly, 3);

  new_credits_used := ROUND(COALESCE(sub_record.credits_used, 0)::numeric + from_monthly, 3);
  new_bonus_credits := ROUND(GREATEST(0::numeric, COALESCE(sub_record.bonus_credits, 0)::numeric - from_bonus), 3);

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
    GREATEST(0::numeric, COALESCE(sub_record.monthly_ai_credits, 0)::numeric - new_credits_used) + new_bonus_credits,
    3
  );

  RETURN json_build_object(
    'success', true,
    'remaining', total_remaining
  );
END;
$$;

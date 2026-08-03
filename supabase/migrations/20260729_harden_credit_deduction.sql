-- Harden the atomic credit deduction RPC.
-- Only service-role server code may call it; amounts and workspace ownership
-- are validated, inactive subscriptions cannot spend, and optional
-- idempotency keys prevent duplicate charges.

CREATE UNIQUE INDEX IF NOT EXISTS credit_transactions_idempotency_idx
  ON public.credit_transactions (
    workspace_id,
    operation,
    ((details ->> 'idempotencyKey'))
  )
  WHERE details ? 'idempotencyKey';

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

  SELECT
    us.credits_used,
    us.bonus_credits,
    us.billing_cycle,
    us.status,
    sp.monthly_ai_credits
  INTO sub_record
  FROM public.user_subscriptions us
  LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = p_user_id
  FOR UPDATE OF us;

  IF NOT FOUND OR sub_record.status NOT IN ('active', 'trialing') THEN
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

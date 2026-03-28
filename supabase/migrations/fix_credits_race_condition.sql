-- Fix: Race condition in credit deduction.
-- Previously: read credits_used → compute new value → write back (non-atomic)
-- Now: atomic increment using a SECURITY DEFINER function with proper locking.

CREATE OR REPLACE FUNCTION deduct_credits(
  ws_id UUID,
  amount INT,
  op TEXT,
  uid UUID,
  e_type TEXT DEFAULT NULL,
  e_id TEXT DEFAULT NULL,
  e_details JSONB DEFAULT '{}'
)
RETURNS JSON AS $$
DECLARE
  sub_record RECORD;
  plan_credits INT;
  new_used INT;
  remaining INT;
BEGIN
  -- Lock the subscription row to prevent concurrent reads
  SELECT ws.credits_used, sp.monthly_ai_credits
  INTO sub_record
  FROM workspace_subscriptions ws
  JOIN subscription_plans sp ON sp.id = ws.plan_id
  WHERE ws.workspace_id = ws_id
  FOR UPDATE OF ws;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'No subscription found', 'remaining', 0);
  END IF;

  plan_credits := COALESCE(sub_record.monthly_ai_credits, 0);
  remaining := GREATEST(0, plan_credits - sub_record.credits_used);

  -- Check if enough credits
  IF remaining < amount THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient credits', 'remaining', remaining);
  END IF;

  -- Atomic increment
  new_used := sub_record.credits_used + amount;
  UPDATE workspace_subscriptions
  SET credits_used = new_used, updated_at = NOW()
  WHERE workspace_id = ws_id;

  -- Log transaction
  INSERT INTO credit_transactions (workspace_id, user_id, operation, credits_used, entity_type, entity_id, details)
  VALUES (ws_id, uid, op, amount, e_type, e_id, e_details);

  RETURN json_build_object('success', true, 'remaining', plan_credits - new_used);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

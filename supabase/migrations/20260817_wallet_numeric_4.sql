-- Store millicent Market Research prices ($0.002/seed, $0.006/row).
-- Also lock down the wallet trigger function and set_mr_updated_at search_path.

ALTER TABLE public.workspace_wallets
  ALTER COLUMN balance_usd TYPE NUMERIC(12, 4);

ALTER TABLE public.wallet_transactions
  ALTER COLUMN amount_usd TYPE NUMERIC(12, 4);

ALTER TABLE public.mr_projects
  ALTER COLUMN extract_charged_usd TYPE NUMERIC(12, 4);

ALTER TABLE public.mr_extracts
  ALTER COLUMN held_usd TYPE NUMERIC(12, 4),
  ALTER COLUMN actual_usd TYPE NUMERIC(12, 4);

ALTER TABLE public.mr_runs
  ALTER COLUMN estimated_usd TYPE NUMERIC(12, 4);

CREATE OR REPLACE FUNCTION public.set_mr_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_workspace_wallet_row() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.charge_workspace_wallet(
  p_workspace_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_description text,
  p_module text,
  p_idempotency_key text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_row public.workspace_wallets%ROWTYPE;
  v_amount numeric(12, 4);
  v_idempotency_key text;
  v_existing_id uuid;
  v_new_balance numeric(12, 4);
  v_tx_id uuid;
BEGIN
  v_amount := ROUND(COALESCE(p_amount, 0), 4);
  IF v_amount < 0 OR v_amount > 1000000 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Amount must be within allowed limits',
      'remaining', 0
    );
  END IF;

  IF p_workspace_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Missing required charge context',
      'remaining', 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_user_id
      AND wm.role IN ('owner', 'admin', 'editor')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Actor is not allowed to spend workspace wallet funds',
      'remaining', 0
    );
  END IF;

  INSERT INTO public.workspace_wallets (workspace_id)
  VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;

  SELECT * INTO v_wallet_row
  FROM public.workspace_wallets
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;

  v_idempotency_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_idempotency_key IS NOT NULL THEN
    SELECT wt.id INTO v_existing_id
    FROM public.wallet_transactions wt
    WHERE wt.workspace_id = p_workspace_id
      AND wt.idempotency_key = v_idempotency_key
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'remaining', v_wallet_row.balance_usd,
        'tx_id', v_existing_id
      );
    END IF;
  END IF;

  IF v_amount = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', false,
      'remaining', v_wallet_row.balance_usd
    );
  END IF;

  IF v_wallet_row.balance_usd < v_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Insufficient wallet funds',
      'remaining', v_wallet_row.balance_usd
    );
  END IF;

  v_new_balance := ROUND(v_wallet_row.balance_usd - v_amount, 4);
  UPDATE public.workspace_wallets
  SET balance_usd = v_new_balance
  WHERE workspace_id = p_workspace_id;

  INSERT INTO public.wallet_transactions (
    workspace_id,
    user_id,
    kind,
    amount_usd,
    description,
    module,
    status,
    idempotency_key,
    details
  )
  VALUES (
    p_workspace_id,
    p_user_id,
    'charge',
    ROUND(v_amount * -1, 4),
    COALESCE(NULLIF(BTRIM(p_description), ''), 'Wallet charge'),
    COALESCE(NULLIF(BTRIM(p_module), ''), 'Market Research'),
    'completed',
    v_idempotency_key,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'remaining', v_new_balance,
    'tx_id', v_tx_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_workspace_wallet(
  p_workspace_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_kind text,
  p_description text,
  p_module text,
  p_method text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_row public.workspace_wallets%ROWTYPE;
  v_amount numeric(12, 4);
  v_kind text;
  v_idempotency_key text;
  v_existing_id uuid;
  v_new_balance numeric(12, 4);
  v_tx_id uuid;
BEGIN
  v_amount := ROUND(COALESCE(p_amount, 0), 4);
  v_kind := LOWER(BTRIM(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('topup', 'refund') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Kind must be topup or refund',
      'remaining', 0
    );
  END IF;

  IF v_amount < 0 OR v_amount > 1000000 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Amount must be within allowed limits',
      'remaining', 0
    );
  END IF;

  IF p_workspace_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Missing required credit context',
      'remaining', 0
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_user_id
      AND wm.role IN ('owner', 'admin', 'editor')
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Actor is not allowed to credit the workspace wallet',
      'remaining', 0
    );
  END IF;

  INSERT INTO public.workspace_wallets (workspace_id)
  VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;

  SELECT * INTO v_wallet_row
  FROM public.workspace_wallets
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;

  v_idempotency_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_idempotency_key IS NOT NULL THEN
    SELECT wt.id INTO v_existing_id
    FROM public.wallet_transactions wt
    WHERE wt.workspace_id = p_workspace_id
      AND wt.idempotency_key = v_idempotency_key
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'remaining', v_wallet_row.balance_usd,
        'tx_id', v_existing_id
      );
    END IF;
  END IF;

  IF v_amount = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'duplicate', false,
      'remaining', v_wallet_row.balance_usd
    );
  END IF;

  v_new_balance := ROUND(v_wallet_row.balance_usd + v_amount, 4);
  UPDATE public.workspace_wallets
  SET balance_usd = v_new_balance
  WHERE workspace_id = p_workspace_id;

  INSERT INTO public.wallet_transactions (
    workspace_id,
    user_id,
    kind,
    amount_usd,
    description,
    module,
    method,
    status,
    idempotency_key,
    details
  )
  VALUES (
    p_workspace_id,
    p_user_id,
    v_kind,
    v_amount,
    COALESCE(NULLIF(BTRIM(p_description), ''), 'Wallet credit'),
    COALESCE(NULLIF(BTRIM(p_module), ''), 'Billing'),
    NULLIF(BTRIM(COALESCE(p_method, '')), ''),
    'completed',
    v_idempotency_key,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'remaining', v_new_balance,
    'tx_id', v_tx_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.charge_workspace_wallet(
  uuid, uuid, numeric, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.charge_workspace_wallet(
  uuid, uuid, numeric, text, text, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.credit_workspace_wallet(
  uuid, uuid, numeric, text, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.credit_workspace_wallet(
  uuid, uuid, numeric, text, text, text, text, text, jsonb
) TO service_role;

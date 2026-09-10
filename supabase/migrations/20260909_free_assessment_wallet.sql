-- Dedicated Free Assessment wallet. Completely separate from
-- workspace_wallets / wallet_transactions used by Growth Engine.

CREATE TABLE IF NOT EXISTS public.fa_wallets (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  balance_usd NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (balance_usd >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  auto_reload_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_reload_threshold NUMERIC(12, 2) NOT NULL DEFAULT 25
    CHECK (auto_reload_threshold >= 0),
  auto_reload_amount NUMERIC(12, 2) NOT NULL DEFAULT 100
    CHECK (auto_reload_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fa_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  kind TEXT NOT NULL CHECK (kind IN ('topup', 'charge', 'refund')),
  amount_usd NUMERIC(12, 4) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL DEFAULT 'free-assessment',
  method TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'pending', 'failed')),
  idempotency_key TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fa_wallet_transactions_amount_sign CHECK (
    (kind = 'charge' AND amount_usd <= 0)
    OR (kind IN ('topup', 'refund') AND amount_usd >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fa_wallet_transactions_idempotency_idx
  ON public.fa_wallet_transactions (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';

CREATE INDEX IF NOT EXISTS fa_wallet_transactions_workspace_created_idx
  ON public.fa_wallet_transactions (workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_fa_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fa_wallets_updated_at ON public.fa_wallets;
CREATE TRIGGER fa_wallets_updated_at
  BEFORE UPDATE ON public.fa_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_fa_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_fa_wallet_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.fa_wallets (workspace_id)
  VALUES (NEW.id)
  ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_ensure_fa_wallet ON public.workspaces;
CREATE TRIGGER workspaces_ensure_fa_wallet
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.ensure_fa_wallet_row();

INSERT INTO public.fa_wallets (workspace_id)
SELECT w.id FROM public.workspaces w
ON CONFLICT (workspace_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.charge_fa_wallet(
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
  v_wallet_row public.fa_wallets%ROWTYPE;
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
      'error', 'Actor is not allowed to spend free-assessment wallet funds',
      'remaining', 0
    );
  END IF;

  INSERT INTO public.fa_wallets (workspace_id)
  VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;

  SELECT * INTO v_wallet_row
  FROM public.fa_wallets
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;

  v_idempotency_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_idempotency_key IS NOT NULL THEN
    SELECT wt.id INTO v_existing_id
    FROM public.fa_wallet_transactions wt
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
  UPDATE public.fa_wallets
  SET balance_usd = v_new_balance
  WHERE workspace_id = p_workspace_id;

  INSERT INTO public.fa_wallet_transactions (
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
    COALESCE(NULLIF(BTRIM(p_module), ''), 'free-assessment'),
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

CREATE OR REPLACE FUNCTION public.credit_fa_wallet(
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
  v_wallet_row public.fa_wallets%ROWTYPE;
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
      'error', 'Actor is not allowed to credit the free-assessment wallet',
      'remaining', 0
    );
  END IF;

  INSERT INTO public.fa_wallets (workspace_id)
  VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;

  SELECT * INTO v_wallet_row
  FROM public.fa_wallets
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;

  v_idempotency_key := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  IF v_idempotency_key IS NOT NULL THEN
    SELECT wt.id INTO v_existing_id
    FROM public.fa_wallet_transactions wt
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
  UPDATE public.fa_wallets
  SET balance_usd = v_new_balance
  WHERE workspace_id = p_workspace_id;

  INSERT INTO public.fa_wallet_transactions (
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

CREATE OR REPLACE FUNCTION public.fa_wallet_spend_summaries(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'spent7', COALESCE((
      SELECT SUM(ABS(amount_usd)) FROM public.fa_wallet_transactions
      WHERE workspace_id = p_workspace_id AND amount_usd < 0
        AND created_at >= now() - interval '7 days'
    ), 0),
    'spent30', COALESCE((
      SELECT SUM(ABS(amount_usd)) FROM public.fa_wallet_transactions
      WHERE workspace_id = p_workspace_id AND amount_usd < 0
        AND created_at >= now() - interval '30 days'
    ), 0),
    'by_module', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('module', module, 'amount', amt) ORDER BY amt DESC)
      FROM (
        SELECT COALESCE(module, '') AS module, SUM(ABS(amount_usd)) AS amt
        FROM public.fa_wallet_transactions
        WHERE workspace_id = p_workspace_id AND amount_usd < 0
        GROUP BY 1
      ) s
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.ensure_fa_wallet_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.charge_fa_wallet(
  uuid, uuid, numeric, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_fa_wallet(
  uuid, uuid, numeric, text, text, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.credit_fa_wallet(
  uuid, uuid, numeric, text, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_fa_wallet(
  uuid, uuid, numeric, text, text, text, text, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.fa_wallet_spend_summaries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fa_wallet_spend_summaries(uuid) TO authenticated, service_role;

ALTER TABLE public.fa_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fa_wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fa_wallet_select" ON public.fa_wallets;
CREATE POLICY "fa_wallet_select" ON public.fa_wallets
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "fa_wallet_tx_select" ON public.fa_wallet_transactions;
CREATE POLICY "fa_wallet_tx_select" ON public.fa_wallet_transactions
  FOR SELECT USING (is_workspace_member(workspace_id));

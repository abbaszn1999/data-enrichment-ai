-- Market Research persistence + workspace USD wallet (separate from AI credits).
-- Agent stages stay free. Apify usage and collection pushes charge this wallet.

CREATE TABLE IF NOT EXISTS public.workspace_wallets (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  balance_usd NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (balance_usd >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  auto_reload_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_reload_threshold NUMERIC(12, 2) NOT NULL DEFAULT 25
    CHECK (auto_reload_threshold >= 0),
  auto_reload_amount NUMERIC(12, 2) NOT NULL DEFAULT 100
    CHECK (auto_reload_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  kind TEXT NOT NULL CHECK (kind IN ('topup', 'charge', 'refund')),
  amount_usd NUMERIC(12, 2) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL DEFAULT '',
  method TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'pending', 'failed')),
  idempotency_key TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_transactions_amount_sign CHECK (
    (kind = 'charge' AND amount_usd <= 0)
    OR (kind IN ('topup', 'refund') AND amount_usd >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_idempotency_idx
  ON public.wallet_transactions (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';

CREATE INDEX IF NOT EXISTS wallet_transactions_workspace_created_idx
  ON public.wallet_transactions (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mr_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'archived')),
  store_label TEXT NOT NULL DEFAULT '',
  highlighted_collection_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(highlighted_collection_ids) = 'array'),
  market TEXT NOT NULL DEFAULT 'us-en',
  current_stage SMALLINT NOT NULL DEFAULT 1
    CHECK (current_stage BETWEEN 1 AND 7),
  opened_max_stage SMALLINT NOT NULL DEFAULT 1
    CHECK (opened_max_stage BETWEEN 1 AND 7),
  state JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(state) = 'object'),
  keywords_path TEXT,
  extract_rows INTEGER NOT NULL DEFAULT 0,
  extract_charged_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mr_projects_workspace_idx
  ON public.mr_projects (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.mr_workspace_prefs (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  active_project_id UUID REFERENCES public.mr_projects(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mr_extracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.mr_projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  market TEXT NOT NULL,
  database TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
  estimated_rows INTEGER NOT NULL DEFAULT 0,
  rows_returned INTEGER NOT NULL DEFAULT 0,
  held_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  actual_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  billing_status TEXT NOT NULL DEFAULT 'held'
    CHECK (billing_status IN ('held', 'settled', 'refunded', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mr_extracts_project_idx
  ON public.mr_extracts (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mr_extracts_workspace_idx
  ON public.mr_extracts (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mr_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.mr_projects(id) ON DELETE CASCADE,
  extract_id UUID REFERENCES public.mr_extracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('seed_probe', 'keyword_extract')),
  seed_id TEXT NOT NULL DEFAULT '',
  seed_term TEXT NOT NULL DEFAULT '',
  apify_run_id TEXT,
  dataset_id TEXT,
  pages INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
  rows_returned INTEGER NOT NULL DEFAULT 0,
  estimated_usd NUMERIC(12, 2) NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mr_runs_apify_run_id_idx
  ON public.mr_runs (workspace_id, apify_run_id)
  WHERE apify_run_id IS NOT NULL AND btrim(apify_run_id) <> '';

CREATE INDEX IF NOT EXISTS mr_runs_extract_idx
  ON public.mr_runs (extract_id);

CREATE OR REPLACE FUNCTION public.set_mr_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_wallets_updated_at ON public.workspace_wallets;
CREATE TRIGGER workspace_wallets_updated_at
  BEFORE UPDATE ON public.workspace_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_updated_at();

DROP TRIGGER IF EXISTS mr_projects_updated_at ON public.mr_projects;
CREATE TRIGGER mr_projects_updated_at
  BEFORE UPDATE ON public.mr_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_updated_at();

DROP TRIGGER IF EXISTS mr_extracts_updated_at ON public.mr_extracts;
CREATE TRIGGER mr_extracts_updated_at
  BEFORE UPDATE ON public.mr_extracts
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_updated_at();

DROP TRIGGER IF EXISTS mr_runs_updated_at ON public.mr_runs;
CREATE TRIGGER mr_runs_updated_at
  BEFORE UPDATE ON public.mr_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_workspace_wallet_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.workspace_wallets (workspace_id)
  VALUES (NEW.id)
  ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_ensure_wallet ON public.workspaces;
CREATE TRIGGER workspaces_ensure_wallet
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.ensure_workspace_wallet_row();

INSERT INTO public.workspace_wallets (workspace_id)
SELECT w.id FROM public.workspaces w
ON CONFLICT (workspace_id) DO NOTHING;

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
  v_amount numeric(12, 2);
  v_idempotency_key text;
  v_existing_id uuid;
  v_new_balance numeric(12, 2);
  v_tx_id uuid;
BEGIN
  v_amount := ROUND(COALESCE(p_amount, 0), 2);
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

  v_new_balance := ROUND(v_wallet_row.balance_usd - v_amount, 2);
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
    ROUND(v_amount * -1, 2),
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
  v_amount numeric(12, 2);
  v_kind text;
  v_idempotency_key text;
  v_existing_id uuid;
  v_new_balance numeric(12, 2);
  v_tx_id uuid;
BEGIN
  v_amount := ROUND(COALESCE(p_amount, 0), 2);
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

  v_new_balance := ROUND(v_wallet_row.balance_usd + v_amount, 2);
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

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'remaining', new_balance,
    'tx_id', tx_id
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

ALTER TABLE public.workspace_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mr_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mr_workspace_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mr_extracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mr_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_select" ON public.workspace_wallets;
CREATE POLICY "wallet_select" ON public.workspace_wallets
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "wallet_tx_select" ON public.wallet_transactions;
CREATE POLICY "wallet_tx_select" ON public.wallet_transactions
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "mr_projects_select" ON public.mr_projects;
DROP POLICY IF EXISTS "mr_projects_insert" ON public.mr_projects;
DROP POLICY IF EXISTS "mr_projects_update" ON public.mr_projects;
DROP POLICY IF EXISTS "mr_projects_delete" ON public.mr_projects;
CREATE POLICY "mr_projects_select" ON public.mr_projects
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "mr_projects_insert" ON public.mr_projects
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "mr_projects_update" ON public.mr_projects
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "mr_projects_delete" ON public.mr_projects
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

DROP POLICY IF EXISTS "mr_prefs_select" ON public.mr_workspace_prefs;
DROP POLICY IF EXISTS "mr_prefs_upsert" ON public.mr_workspace_prefs;
DROP POLICY IF EXISTS "mr_prefs_update" ON public.mr_workspace_prefs;
CREATE POLICY "mr_prefs_select" ON public.mr_workspace_prefs
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "mr_prefs_insert" ON public.mr_workspace_prefs
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "mr_prefs_update" ON public.mr_workspace_prefs
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));

DROP POLICY IF EXISTS "mr_extracts_select" ON public.mr_extracts;
CREATE POLICY "mr_extracts_select" ON public.mr_extracts
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "mr_runs_select" ON public.mr_runs;
CREATE POLICY "mr_runs_select" ON public.mr_runs
  FOR SELECT USING (is_workspace_member(workspace_id));

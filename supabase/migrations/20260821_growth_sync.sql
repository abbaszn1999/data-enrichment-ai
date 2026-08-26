-- Growth Sync engine: watch store taxonomies, classify newly created products
-- into a Market Research project's live taxonomies, log every decision.
--
-- Column names are provider-neutral on purpose. Shopify hands back
-- "gid://shopify/Product/1" while WooCommerce hands back "12345", so every
-- external identifier is a `*_ref TEXT` rather than a gid-shaped column.

-- ─── Rules ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gs_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.mr_projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Stored so a rule fails loudly if the workspace swaps its integration,
  -- instead of quietly classifying against a store that no longer exists.
  provider TEXT NOT NULL,
  run_interval TEXT NOT NULL DEFAULT '24h'
    CHECK (run_interval IN ('manual', '1h', '6h', '12h', '24h')),
  -- [{ "ref": "...", "title": "...", "productCount": 0 }]
  watched_taxonomies JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(watched_taxonomies) = 'array'),
  mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'review')),
  next_run_at TIMESTAMPTZ,
  -- Held by the tick that is currently processing this rule, so two overlapping
  -- ticks cannot classify the same products twice.
  lease_until TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gs_rules_workspace_name_idx
  ON public.gs_rules (workspace_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS gs_rules_workspace_idx
  ON public.gs_rules (workspace_id, created_at DESC);

-- Drives the claim query: only enabled, unleased, due rules are scanned.
CREATE INDEX IF NOT EXISTS gs_rules_due_idx
  ON public.gs_rules (next_run_at)
  WHERE enabled AND run_interval <> 'manual';

-- ─── Watermarks ──────────────────────────────────────────────────────────────

-- One row per (rule, watched taxonomy). Seeded with now() when the rule is
-- created, which is what keeps the engine off the existing back catalogue.
CREATE TABLE IF NOT EXISTS public.gs_watermarks (
  rule_id UUID NOT NULL REFERENCES public.gs_rules(id) ON DELETE CASCADE,
  taxonomy_ref TEXT NOT NULL,
  last_product_created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_product_ref TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, taxonomy_ref)
);

-- ─── Runs ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gs_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.gs_rules(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  detected_count INTEGER NOT NULL DEFAULT 0,
  classified_count INTEGER NOT NULL DEFAULT 0,
  assigned_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gs_runs_rule_idx
  ON public.gs_runs (rule_id, started_at DESC);

CREATE INDEX IF NOT EXISTS gs_runs_workspace_idx
  ON public.gs_runs (workspace_id, started_at DESC);

-- ─── Activity ────────────────────────────────────────────────────────────────

-- One row per decision, including the rejections. A skipped product with a
-- reason is the difference between an auditable engine and a black box.
CREATE TABLE IF NOT EXISTS public.gs_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.gs_runs(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.gs_rules(id) ON DELETE CASCADE,
  product_ref TEXT NOT NULL,
  product_title TEXT NOT NULL DEFAULT '',
  product_url TEXT,
  product_image_url TEXT,
  source_taxonomy_ref TEXT,
  taxonomy_ref TEXT,
  taxonomy_name TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL CHECK (decision IN ('assigned', 'skipped', 'failed')),
  score NUMERIC(6, 4),
  reason TEXT NOT NULL DEFAULT '',
  -- Set when the provider queued the removal rather than applying it inline.
  pending_job_ref TEXT,
  undone_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gs_activity_workspace_idx
  ON public.gs_activity (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gs_activity_run_idx
  ON public.gs_activity (run_id);

-- ─── Quotas ──────────────────────────────────────────────────────────────────

-- Classification packs. Deliberately separate from workspace_wallets: a pack
-- is a monthly allowance of classifications, not a USD balance.
CREATE TABLE IF NOT EXISTS public.gs_quotas (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pack_id TEXT,
  included_classifications INTEGER NOT NULL DEFAULT 0
    CHECK (included_classifications >= 0),
  used_classifications INTEGER NOT NULL DEFAULT 0
    CHECK (used_classifications >= 0),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Triggers ────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS gs_rules_updated_at ON public.gs_rules;
CREATE TRIGGER gs_rules_updated_at
  BEFORE UPDATE ON public.gs_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_updated_at();

DROP TRIGGER IF EXISTS gs_watermarks_updated_at ON public.gs_watermarks;
CREATE TRIGGER gs_watermarks_updated_at
  BEFORE UPDATE ON public.gs_watermarks
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_updated_at();

DROP TRIGGER IF EXISTS gs_quotas_updated_at ON public.gs_quotas;
CREATE TRIGGER gs_quotas_updated_at
  BEFORE UPDATE ON public.gs_quotas
  FOR EACH ROW EXECUTE FUNCTION public.set_mr_updated_at();

-- ─── Interval helper ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.gs_interval_to_minutes(p_interval text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_interval
    WHEN '1h' THEN 60
    WHEN '6h' THEN 360
    WHEN '12h' THEN 720
    WHEN '24h' THEN 1440
    ELSE NULL
  END;
$$;

-- ─── Claim ───────────────────────────────────────────────────────────────────

-- Hand out due rules and lease them in the same transaction. SKIP LOCKED means
-- a second tick arriving mid-run walks past the rows already taken instead of
-- blocking on them.
CREATE OR REPLACE FUNCTION public.claim_gs_rules(
  p_limit integer DEFAULT 5,
  p_lease_minutes integer DEFAULT 10
)
RETURNS SETOF public.gs_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT r.id
    FROM public.gs_rules r
    WHERE r.enabled
      AND r.run_interval <> 'manual'
      AND r.next_run_at IS NOT NULL
      AND r.next_run_at <= now()
      AND (r.lease_until IS NULL OR r.lease_until <= now())
    ORDER BY r.next_run_at
    LIMIT GREATEST(COALESCE(p_limit, 5), 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.gs_rules r
  SET lease_until = now() + make_interval(mins => GREATEST(COALESCE(p_lease_minutes, 10), 1))
  FROM due
  WHERE r.id = due.id
  RETURNING r.*;
END;
$$;

-- Release the lease and schedule the next run. Called once per rule whether the
-- run succeeded or failed, so a crash mid-pipeline cannot strand a lease past
-- its expiry.
CREATE OR REPLACE FUNCTION public.release_gs_rule(
  p_rule_id uuid,
  p_error text DEFAULT NULL,
  p_disable boolean DEFAULT false,
  -- Set when the run stopped at its per-run ceiling with products still queued.
  -- Waiting a full interval to continue a backlog would only make it deeper.
  p_due_now boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_minutes integer;
BEGIN
  SELECT public.gs_interval_to_minutes(run_interval)
  INTO v_minutes
  FROM public.gs_rules
  WHERE id = p_rule_id;

  UPDATE public.gs_rules
  SET lease_until = NULL,
      last_run_at = now(),
      last_error = NULLIF(BTRIM(COALESCE(p_error, '')), ''),
      enabled = CASE WHEN p_disable THEN false ELSE enabled END,
      next_run_at = CASE
        WHEN v_minutes IS NULL THEN NULL
        WHEN p_due_now THEN now()
        ELSE now() + make_interval(mins => v_minutes)
      END
  WHERE id = p_rule_id;
END;
$$;

-- Take the lease for a single rule, for "Run now". Returns the row only if the
-- lease was free, so two clicks — or a click landing on top of a tick — cannot
-- both enter the same rule and classify the same products twice.
CREATE OR REPLACE FUNCTION public.lease_gs_rule(
  p_rule_id uuid,
  p_lease_minutes integer DEFAULT 10
)
RETURNS SETOF public.gs_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH free AS (
    SELECT r.id
    FROM public.gs_rules r
    WHERE r.id = p_rule_id
      AND (r.lease_until IS NULL OR r.lease_until <= now())
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.gs_rules r
  SET lease_until = now() + make_interval(mins => GREATEST(COALESCE(p_lease_minutes, 10), 1))
  FROM free
  WHERE r.id = free.id
  RETURNING r.*;
END;
$$;

-- Hand a claimed rule back without consuming its turn: the lease is dropped but
-- `next_run_at` is untouched, so the rule is still due and the next tick takes
-- it. Used when a tick runs out of wall clock before reaching every rule it
-- claimed — waiting for the lease to expire would stall it for no reason.
CREATE OR REPLACE FUNCTION public.defer_gs_rule(p_rule_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.gs_rules
  SET lease_until = NULL
  WHERE id = p_rule_id;
$$;

-- ─── Quota accounting ────────────────────────────────────────────────────────

-- Reserve classifications before the AI call. Returns success=false with the
-- remaining count so the caller can stop rather than overspend.
CREATE OR REPLACE FUNCTION public.consume_gs_quota(
  p_workspace_id uuid,
  p_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.gs_quotas%ROWTYPE;
  v_count integer;
  v_remaining integer;
BEGIN
  v_count := GREATEST(COALESCE(p_count, 0), 0);
  IF p_workspace_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing workspace', 'remaining', 0);
  END IF;

  INSERT INTO public.gs_quotas (workspace_id)
  VALUES (p_workspace_id)
  ON CONFLICT (workspace_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.gs_quotas
  WHERE workspace_id = p_workspace_id
  FOR UPDATE;

  IF v_row.pack_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_pack', 'remaining', 0);
  END IF;

  -- An expired period is a lapsed pack, not an unlimited one.
  IF v_row.period_end IS NOT NULL AND v_row.period_end <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'pack_expired', 'remaining', 0);
  END IF;

  v_remaining := v_row.included_classifications - v_row.used_classifications;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('success', true, 'remaining', v_remaining);
  END IF;

  IF v_remaining < v_count THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'quota_exhausted',
      'remaining', GREATEST(v_remaining, 0)
    );
  END IF;

  UPDATE public.gs_quotas
  SET used_classifications = used_classifications + v_count
  WHERE workspace_id = p_workspace_id;

  RETURN jsonb_build_object('success', true, 'remaining', v_remaining - v_count);
END;
$$;

-- Give back an over-reservation. Floors at zero so a double refund cannot mint
-- allowance out of nothing.
CREATE OR REPLACE FUNCTION public.release_gs_quota(
  p_workspace_id uuid,
  p_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used integer;
BEGIN
  IF p_workspace_id IS NULL OR COALESCE(p_count, 0) <= 0 THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  UPDATE public.gs_quotas
  SET used_classifications = GREATEST(used_classifications - p_count, 0)
  WHERE workspace_id = p_workspace_id
  RETURNING used_classifications INTO v_used;

  RETURN jsonb_build_object('success', true, 'used', COALESCE(v_used, 0));
END;
$$;

-- ─── Function grants ─────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.claim_gs_rules(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gs_rules(integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.release_gs_rule(uuid, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_gs_rule(uuid, text, boolean, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.lease_gs_rule(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lease_gs_rule(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.defer_gs_rule(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.defer_gs_rule(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.consume_gs_quota(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_gs_quota(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.release_gs_quota(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_gs_quota(uuid, integer) TO service_role;

-- ─── Row level security ──────────────────────────────────────────────────────

ALTER TABLE public.gs_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gs_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gs_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gs_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gs_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gs_rules_select" ON public.gs_rules;
DROP POLICY IF EXISTS "gs_rules_insert" ON public.gs_rules;
DROP POLICY IF EXISTS "gs_rules_update" ON public.gs_rules;
DROP POLICY IF EXISTS "gs_rules_delete" ON public.gs_rules;
CREATE POLICY "gs_rules_select" ON public.gs_rules
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY "gs_rules_insert" ON public.gs_rules
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "gs_rules_update" ON public.gs_rules
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));
CREATE POLICY "gs_rules_delete" ON public.gs_rules
  FOR DELETE USING (is_workspace_member(workspace_id, 'editor'));

-- Watermarks carry no workspace_id of their own; membership is inherited from
-- the owning rule so the engine cannot be tricked into reading another
-- workspace's position by guessing a rule id.
DROP POLICY IF EXISTS "gs_watermarks_select" ON public.gs_watermarks;
CREATE POLICY "gs_watermarks_select" ON public.gs_watermarks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.gs_rules r
      WHERE r.id = gs_watermarks.rule_id
        AND is_workspace_member(r.workspace_id)
    )
  );

DROP POLICY IF EXISTS "gs_runs_select" ON public.gs_runs;
CREATE POLICY "gs_runs_select" ON public.gs_runs
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "gs_activity_select" ON public.gs_activity;
CREATE POLICY "gs_activity_select" ON public.gs_activity
  FOR SELECT USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "gs_quotas_select" ON public.gs_quotas;
CREATE POLICY "gs_quotas_select" ON public.gs_quotas
  FOR SELECT USING (is_workspace_member(workspace_id));

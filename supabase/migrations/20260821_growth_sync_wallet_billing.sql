-- Growth Sync: bill the workspace wallet instead of a separate classification
-- pack, and lock the schedule down to manual or every-24-hours.
--
-- Run this AFTER 20260821_growth_sync.sql and 20260817_market_research_wallet.sql.

-- ─── Schedule: only manual or every 24 hours ─────────────────────────────────

-- Existing rules on a shorter cadence move to the daily schedule rather than
-- being left with a value the app (and the CHECK below) no longer accepts.
UPDATE public.gs_rules
SET run_interval = '24h'
WHERE run_interval IN ('1h', '6h', '12h');

ALTER TABLE public.gs_rules
  DROP CONSTRAINT IF EXISTS gs_rules_run_interval_check;
ALTER TABLE public.gs_rules
  ADD CONSTRAINT gs_rules_run_interval_check
  CHECK (run_interval IN ('manual', '24h'));

CREATE OR REPLACE FUNCTION public.gs_interval_to_minutes(p_interval text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_interval
    WHEN '24h' THEN 1440
    ELSE NULL
  END;
$$;

-- ─── Billing: drop the classification-pack quota system ─────────────────────
--
-- Sync now charges the workspace wallet directly, at the AI's real cost, via
-- the same `charge_workspace_wallet` / `credit_workspace_wallet` RPCs Market
-- Research uses (see 20260817_market_research_wallet.sql). The pack counter
-- and its reserve/release RPCs have no remaining caller.

REVOKE ALL ON FUNCTION public.consume_gs_quota(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_gs_quota(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.consume_gs_quota(uuid, integer);
DROP FUNCTION IF EXISTS public.release_gs_quota(uuid, integer);

DROP TABLE IF EXISTS public.gs_quotas CASCADE;

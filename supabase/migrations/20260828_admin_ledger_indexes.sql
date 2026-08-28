-- Ledger list pages load one range at a time (PostgREST .range + count=exact).
-- Keep (created_at, id) ordered so OFFSET stays index-backed and pages are stable.

CREATE INDEX IF NOT EXISTS credit_transactions_created_id_idx
  ON public.credit_transactions (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS wallet_transactions_created_id_idx
  ON public.wallet_transactions (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS job_runs_created_id_idx
  ON public.job_runs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS activity_log_created_id_idx
  ON public.activity_log (created_at DESC, id DESC);

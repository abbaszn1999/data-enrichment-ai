-- A dedicated user → Stripe customer mapping for real-money wallet top-ups.
--
-- The wallet is billed per-workspace, but Stripe customers are naturally
-- per-person (whoever's card is on file), so this stays keyed by user_id —
-- same shape as `user_subscriptions.stripe_customer_id`. It is deliberately
-- its own table rather than reusing `user_subscriptions`: that table's
-- `plan_id`/`status`/`billing_cycle` columns are NOT NULL and drive
-- subscription-gated access elsewhere in the app, so inserting a
-- customer-only row there for a user with no real plan would either violate
-- those constraints or silently make them look subscribed. Wallet top-ups
-- must work for a user who has never bought a subscription.

CREATE TABLE IF NOT EXISTS public.wallet_stripe_customers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_stripe_customers ENABLE ROW LEVEL SECURITY;
-- No policies: only ever read/written by the server's admin (service-role)
-- client inside API routes, same as `webhook_events`.

REVOKE ALL ON public.wallet_stripe_customers FROM PUBLIC, anon, authenticated;

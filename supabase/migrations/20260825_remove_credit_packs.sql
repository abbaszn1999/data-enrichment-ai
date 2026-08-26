-- Credit Packs are replaced by a free-form "buy N credits" top-up (same
-- pattern as the wallet top-up: user picks an amount, Stripe gets a dynamic
-- price_data line item — no pre-created Stripe Price / pack row needed).
-- credit_purchases is kept as the purchase log, just without the pack link.

alter table public.credit_purchases
  drop column if exists pack_id;

drop table if exists public.credit_packs;

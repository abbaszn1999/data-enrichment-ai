-- Align SaaS billing with autommerce.com/pricing:
-- Growth / Pro self-serve, Enterprise quote-only, Starter hidden (grandfathered).
-- Do not cancel existing Starter subscribers. Do not create a Stripe Enterprise price.

UPDATE public.subscription_plans
SET
  is_active = false,
  description = 'Legacy Starter — no longer sold. Existing subscribers stay until sales migrates them.'
WHERE name = 'starter';

UPDATE public.subscription_plans
SET
  stripe_product_id = 'prod_UGecoPJRbOI2ol'
WHERE name = 'starter'
  AND stripe_price_monthly_id = 'price_1TI7JNPfGzfuCByPAKWc9Mmj';

UPDATE public.subscription_plans
SET
  display_name = 'Growth',
  description = 'For growing ecommerce teams. Same OS product as Pro — more capacity, seats, and support.',
  monthly_ai_credits = 3200,
  price_monthly = 1500,
  price_yearly = 1200,
  max_workspaces = 2,
  max_members_per_workspace = 10,
  max_products_per_workspace = NULL,
  max_imports_per_month = NULL,
  is_active = true,
  sort_order = 1
WHERE name = 'growth';

UPDATE public.subscription_plans
SET
  stripe_product_id = 'prod_UGefao448fl34O'
WHERE name = 'growth'
  AND stripe_price_monthly_id = 'price_1TI7MSPfGzfuCByPq7Mncsxo';

UPDATE public.subscription_plans
SET
  display_name = 'Pro',
  description = 'For larger retail operations. Same OS product as Growth — higher capacity, seats, and white-glove support.',
  monthly_ai_credits = 7000,
  price_monthly = 2500,
  price_yearly = 2000,
  max_workspaces = 5,
  max_members_per_workspace = 20,
  max_products_per_workspace = NULL,
  max_imports_per_month = NULL,
  is_active = true,
  sort_order = 2
WHERE name = 'pro';

UPDATE public.subscription_plans
SET
  stripe_product_id = 'prod_UGegjkopEzfRzx'
WHERE name = 'pro'
  AND stripe_price_monthly_id = 'price_1TI7NPPfGzfuCByPiGDzRbPS';

INSERT INTO public.subscription_plans (
  name,
  display_name,
  description,
  monthly_ai_credits,
  price_monthly,
  price_yearly,
  is_active,
  sort_order,
  max_workspaces,
  max_members_per_workspace,
  max_products_per_workspace,
  max_imports_per_month,
  stripe_product_id,
  stripe_price_monthly_id,
  stripe_price_yearly_id
) VALUES (
  'enterprise',
  'Enterprise',
  'Custom pool, seats, and SLA. Assigned after a quote — not self-serve checkout.',
  0,
  0,
  0,
  false,
  3,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  monthly_ai_credits = EXCLUDED.monthly_ai_credits,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  max_workspaces = EXCLUDED.max_workspaces,
  max_members_per_workspace = EXCLUDED.max_members_per_workspace,
  max_products_per_workspace = EXCLUDED.max_products_per_workspace,
  max_imports_per_month = EXCLUDED.max_imports_per_month,
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_yearly_id = EXCLUDED.stripe_price_yearly_id;

DO $$
DECLARE
  starter_active boolean;
  growth_credits integer;
  growth_price numeric;
  growth_workspaces integer;
  growth_members integer;
  pro_credits integer;
  pro_price numeric;
  pro_workspaces integer;
  pro_members integer;
BEGIN
  SELECT is_active INTO starter_active FROM public.subscription_plans WHERE name = 'starter';
  IF starter_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Starter must be hidden from the self-serve catalog';
  END IF;

  SELECT monthly_ai_credits, price_monthly, max_workspaces, max_members_per_workspace
    INTO growth_credits, growth_price, growth_workspaces, growth_members
  FROM public.subscription_plans WHERE name = 'growth';

  SELECT monthly_ai_credits, price_monthly, max_workspaces, max_members_per_workspace
    INTO pro_credits, pro_price, pro_workspaces, pro_members
  FROM public.subscription_plans WHERE name = 'pro';

  IF growth_credits IS DISTINCT FROM 3200
     OR growth_price IS DISTINCT FROM 1500
     OR growth_workspaces IS DISTINCT FROM 2
     OR growth_members IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'Growth entitlements are %, $%, % workspaces, % users — expected 3200 / 1500 / 2 / 10',
      growth_credits, growth_price, growth_workspaces, growth_members;
  END IF;

  IF pro_credits IS DISTINCT FROM 7000
     OR pro_price IS DISTINCT FROM 2500
     OR pro_workspaces IS DISTINCT FROM 5
     OR pro_members IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'Pro entitlements are %, $%, % workspaces, % users — expected 7000 / 2500 / 5 / 20',
      pro_credits, pro_price, pro_workspaces, pro_members;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscription_plans
    WHERE name = 'enterprise'
      AND (
        stripe_product_id IS NOT NULL
        OR stripe_price_monthly_id IS NOT NULL
        OR stripe_price_yearly_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Enterprise must not have a Stripe product or price';
  END IF;
END $$;

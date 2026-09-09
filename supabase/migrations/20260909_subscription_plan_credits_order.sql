-- Catalog Intelligence / billing: Starter → Growth → Pro, with the new monthly
-- credit allotments. Dollar prices and Stripe price IDs stay unchanged.

UPDATE public.subscription_plans AS p
SET
  monthly_ai_credits = v.credits,
  sort_order = v.sort_order
FROM (
  VALUES
    ('starter', 1600, 1),
    ('growth', 3200, 2),
    ('pro', 7000, 3)
) AS v(name, credits, sort_order)
WHERE p.name = v.name;

DO $$
DECLARE
  ordered text[];
  starter_credits integer;
  growth_credits integer;
  pro_credits integer;
BEGIN
  SELECT array_agg(name ORDER BY sort_order)
  INTO ordered
  FROM public.subscription_plans
  WHERE is_active;

  IF ordered IS DISTINCT FROM ARRAY['starter', 'growth', 'pro']::text[] THEN
    RAISE EXCEPTION 'Active plan order is %, expected starter, growth, pro', ordered;
  END IF;

  SELECT monthly_ai_credits INTO starter_credits FROM public.subscription_plans WHERE name = 'starter';
  SELECT monthly_ai_credits INTO growth_credits FROM public.subscription_plans WHERE name = 'growth';
  SELECT monthly_ai_credits INTO pro_credits FROM public.subscription_plans WHERE name = 'pro';

  IF starter_credits IS DISTINCT FROM 1600
     OR growth_credits IS DISTINCT FROM 3200
     OR pro_credits IS DISTINCT FROM 7000 THEN
    RAISE EXCEPTION
      'Plan credits are starter=%, growth=%, pro=% — expected 1600/3200/7000',
      starter_credits, growth_credits, pro_credits;
  END IF;
END $$;

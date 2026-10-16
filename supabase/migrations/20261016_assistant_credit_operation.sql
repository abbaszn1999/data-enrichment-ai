-- Lets the Agent charge its own reasoning cost (ASSISTANT_BILLING_MODE=charge).
-- Same list as the live constraint, plus 'assistant'.
ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_operation_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_operation_check
  CHECK (operation = ANY (ARRAY[
    'catalog_intelligence'::text,
    'ai_image_search'::text,
    'ai_column_mapping'::text,
    'ai_category_suggest'::text,
    'ai_function'::text,
    'store_assistant'::text,
    'image_classification'::text,
    'gallery_google'::text,
    'gallery_ai'::text,
    'visualizer_description'::text,
    'visualizer_images'::text,
    'credit_topup'::text,
    'monthly_reset'::text,
    'assistant'::text
  ]));

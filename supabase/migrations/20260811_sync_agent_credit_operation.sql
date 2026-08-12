-- Add distinct credit operation for Sync agent (Vera), separate from AI Function.
ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_operation_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_operation_check
  CHECK (operation = ANY (ARRAY[
    'ai_enrichment'::text,
    'ai_image_search'::text,
    'ai_column_mapping'::text,
    'ai_category_suggest'::text,
    'ai_function'::text,
    'sync_agent'::text,
    'image_classification'::text,
    'gallery_google'::text,
    'gallery_ai'::text,
    'visualizer_description'::text,
    'visualizer_images'::text,
    'credit_topup'::text,
    'monthly_reset'::text
  ]));

-- Relabel historical Sync deductions that were stored as ai_function.
UPDATE public.credit_transactions
SET operation = 'sync_agent'
WHERE operation = 'ai_function'
  AND entity_type = 'sync_agent';

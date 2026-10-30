-- Store Agent files: the folder each of the agent's files is shown in.
-- Files go by where they came from, not by format: Store data (from the store),
-- Reports (the agent's own work), Images, Working files. from_store keeps that
-- origin for files made from store data, so it holds when they are opened later.

ALTER TABLE public.store_agent_files
  ADD COLUMN IF NOT EXISTS folder TEXT CHECK (folder IN ('store_data', 'reports', 'images', 'working')),
  ADD COLUMN IF NOT EXISTS from_store BOOLEAN NOT NULL DEFAULT false;

-- Files from before: sorted once by where they are.
UPDATE public.store_agent_files
SET
  from_store = storage_path ~ '/(exports|shopify-results|woo-results)/',
  folder = CASE
    WHEN storage_path ~ '/(shopify-results|woo-results|previews)/' OR storage_path ~* '\.jsonl$' THEN 'working'
    WHEN storage_path ~ '/exports/' THEN 'store_data'
    WHEN NOT shown THEN 'working'
    WHEN storage_path ~* '\.(png|jpe?g|webp|gif|svg)$' THEN 'images'
    ELSE 'reports'
  END
WHERE created_by = 'agent'
  AND folder IS NULL
  AND storage_path !~ '/(backups|attachments|file-views)/';

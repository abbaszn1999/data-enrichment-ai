-- Store Agent files: results and working files.
-- A file Vera put in front of the user (opened it, or made it for them: an
-- Excel file, an image) is a result; the rest are her working files, kept
-- out of the way in the panel.

ALTER TABLE public.store_agent_files
  ADD COLUMN IF NOT EXISTS shown BOOLEAN NOT NULL DEFAULT false;

-- Files from before: everything but raw store results, JSON-lines working
-- data, change previews and backups was meant for the user.
UPDATE public.store_agent_files
SET shown = true
WHERE created_by = 'agent'
  AND shown = false
  AND storage_path !~ '/(shopify-results|woo-results|backups|previews)/'
  AND storage_path !~* '\.jsonl$';

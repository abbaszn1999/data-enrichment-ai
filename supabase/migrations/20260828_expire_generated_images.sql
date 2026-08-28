-- Delete AI-generated Gallery/Visualizer row images after 30 UTC calendar days.
-- Paths: {workspace}/gallery/{session}/rows/... and
--        {workspace}/description-visualizer/{session}/rows/...
-- Worksheets, source files, exports, logos, and brand guides are not listed.
-- The app removes objects through the Storage API so S3 and the catalog stay in sync.

CREATE OR REPLACE FUNCTION public.list_expired_generated_images(
  p_days integer DEFAULT 30,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (object_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.name
  FROM storage.objects o
  WHERE o.bucket_id = 'workspace-files'
    AND (o.created_at AT TIME ZONE 'utc')::date
        <= ((timezone('utc', now()))::date - GREATEST(p_days, 1))
    AND (
      o.name LIKE '%/gallery/%/rows/%'
      OR o.name LIKE '%/description-visualizer/%/rows/%'
    )
    AND o.name NOT LIKE '%/settings/%'
  ORDER BY o.created_at ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$$;

COMMENT ON FUNCTION public.list_expired_generated_images(integer, integer) IS
  'Service role: generated Gallery/Visualizer /rows/ objects older than p_days (UTC date).';

REVOKE ALL ON FUNCTION public.list_expired_generated_images(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_expired_generated_images(integer, integer)
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('expire-generated-images')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-generated-images');

SELECT cron.schedule(
  'expire-generated-images',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'growth_sync_app_origin'
    ) || '/api/storage/expire-generated-images',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'growth_sync_cron_secret'
      )
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
  $$
);

-- Heartbeat for background job orchestrators. Reuses the existing
-- growth_sync_app_origin + growth_sync_cron_secret Vault entries so this
-- can be applied without a new secret. Override later with JOBS_CRON_SECRET
-- if you split schedulers.
--
-- The app endpoint /api/jobs/sweep accepts GROWTH_SYNC_CRON_SECRET or JOBS_CRON_SECRET.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('jobs-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jobs-sweep');

SELECT cron.schedule(
  'jobs-sweep',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'growth_sync_app_origin'
    ) || '/api/jobs/sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'growth_sync_cron_secret'
      )
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 55000
  );
  $$
);

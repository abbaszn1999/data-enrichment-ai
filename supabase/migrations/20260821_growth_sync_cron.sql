-- Schedule the Growth Sync tick from inside Postgres.
--
-- Run this AFTER 20260821_growth_sync.sql and after the app is deployed, and
-- replace the two placeholder values below first.
--
-- Notes that matter in production:
--   * pg_cron always evaluates schedules in UTC. The cadence here is only a
--     heartbeat: each rule's own `next_run_at` decides when it actually runs,
--     so there is no per-interval schedule to maintain.
--   * pg_net is fire-and-forget. It does not retry, does not alert on a non-2xx,
--     and only records the response in `net._http_response`. The tick endpoint
--     is therefore built to be resumable rather than to be retried.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Secrets live in Vault, never inline in the schedule body: cron.job is
-- readable by anyone who can read the catalog.
SELECT vault.create_secret(
  'https://data-enrichment-ai.onrender.com',  -- ← your deployed origin
  'growth_sync_app_origin'
);

SELECT vault.create_secret(
  '35b6c1682a28b9a25ae8e0253279cad49f232a26f1af9a401f39c7a89681ba3e',  -- ← GROWTH_SYNC_CRON_SECRET
  'growth_sync_cron_secret'
);

SELECT cron.unschedule('growth-sync-tick')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'growth-sync-tick');

SELECT cron.schedule(
  'growth-sync-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret FROM vault.decrypted_secrets
      WHERE name = 'growth_sync_app_origin'
    ) || '/api/growth-sync/tick',
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

-- Verification:
--   SELECT jobname, schedule, active FROM cron.job;
--   SELECT status, created FROM net._http_response ORDER BY created DESC LIMIT 5;

-- Repoint Growth Sync cron at Autommerce Platform.
-- Do not edit 20260821_growth_sync_cron.sql — applied migrations are immutable.

DO $$
DECLARE
  secret_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'vault') THEN
    RETURN;
  END IF;

  SELECT id INTO secret_id
  FROM vault.secrets
  WHERE name = 'growth_sync_app_origin'
  LIMIT 1;

  IF secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(secret_id, 'https://platform.autommerce.com');
  ELSE
    PERFORM vault.create_secret(
      'https://platform.autommerce.com',
      'growth_sync_app_origin'
    );
  END IF;
EXCEPTION
  WHEN undefined_function OR undefined_table THEN
    RAISE NOTICE 'vault not available; skipped growth_sync_app_origin update';
  WHEN OTHERS THEN
    RAISE NOTICE 'growth_sync_app_origin not updated: %', SQLERRM;
END $$;

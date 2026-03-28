-- Remove unused columns from import_sessions table
-- These columns are no longer read or written by the application code

ALTER TABLE import_sessions DROP COLUMN IF EXISTS column_mapping;
ALTER TABLE import_sessions DROP COLUMN IF EXISTS file_id;
ALTER TABLE import_sessions DROP COLUMN IF EXISTS supplier_id;
ALTER TABLE import_sessions DROP COLUMN IF EXISTS tags;
ALTER TABLE import_sessions DROP COLUMN IF EXISTS enrichment_columns;
ALTER TABLE import_sessions DROP COLUMN IF EXISTS enrichment_settings;
ALTER TABLE import_sessions DROP COLUMN IF EXISTS updated_count;

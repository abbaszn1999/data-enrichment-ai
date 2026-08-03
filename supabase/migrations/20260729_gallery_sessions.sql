-- Products Gallery: thin session metadata table + Storage JSON for worksheet rows.
-- Mirrors import_sessions / image_classification_sessions pattern.

CREATE TABLE IF NOT EXISTS gallery_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'processing', 'completed', 'failed')),
  source_file_name TEXT NOT NULL DEFAULT '',
  storage_path TEXT,
  images_prefix TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  ready_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  total_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  total_credits NUMERIC(12, 3) NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gallery_sessions_workspace_idx
  ON gallery_sessions (workspace_id, created_at DESC);

ALTER TABLE gallery_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gallery_sessions_select" ON gallery_sessions;
DROP POLICY IF EXISTS "gallery_sessions_insert" ON gallery_sessions;
DROP POLICY IF EXISTS "gallery_sessions_update" ON gallery_sessions;
DROP POLICY IF EXISTS "gallery_sessions_delete" ON gallery_sessions;

CREATE POLICY "gallery_sessions_select" ON gallery_sessions
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "gallery_sessions_insert" ON gallery_sessions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "gallery_sessions_update" ON gallery_sessions
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "gallery_sessions_delete" ON gallery_sessions
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

CREATE OR REPLACE FUNCTION set_gallery_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gallery_sessions_updated_at ON gallery_sessions;

CREATE TRIGGER gallery_sessions_updated_at
  BEFORE UPDATE ON gallery_sessions
  FOR EACH ROW EXECUTE FUNCTION set_gallery_sessions_updated_at();

-- Allow gallery credit operations
ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_operation_check;

ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_operation_check
  CHECK (operation = ANY (ARRAY[
    'ai_enrichment'::text,
    'ai_image_search'::text,
    'ai_column_mapping'::text,
    'ai_category_suggest'::text,
    'ai_function'::text,
    'image_classification'::text,
    'gallery_google'::text,
    'gallery_ai'::text,
    'credit_topup'::text,
    'monthly_reset'::text
  ]));

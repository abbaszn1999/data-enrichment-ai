-- Image Classification feature: sessions table + RLS, mirroring import_sessions pattern.
-- Each session represents an upload batch of product images that are sent to
-- Gemini 3.5 Flash in a single multimodal request for grouping/classification.
-- Image binaries and the resulting classification JSON live in the existing
-- `workspace-files` Storage bucket; this table only stores metadata.

CREATE TABLE IF NOT EXISTS image_classification_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  total_images INTEGER NOT NULL DEFAULT 0,
  group_count INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
  -- Path inside workspace-files bucket for the result JSON (groups + per-image labels).
  storage_path TEXT,
  -- Path prefix where the uploaded thumbnails are stored for this session.
  images_prefix TEXT,
  total_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  total_credits NUMERIC(12, 3) NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_classification_sessions_workspace_idx
  ON image_classification_sessions (workspace_id, created_at DESC);

ALTER TABLE image_classification_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "img_sessions_select" ON image_classification_sessions;
DROP POLICY IF EXISTS "img_sessions_insert" ON image_classification_sessions;
DROP POLICY IF EXISTS "img_sessions_update" ON image_classification_sessions;
DROP POLICY IF EXISTS "img_sessions_delete" ON image_classification_sessions;

CREATE POLICY "img_sessions_select" ON image_classification_sessions
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "img_sessions_insert" ON image_classification_sessions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "img_sessions_update" ON image_classification_sessions
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "img_sessions_delete" ON image_classification_sessions
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

-- Keep updated_at fresh on every update.
CREATE OR REPLACE FUNCTION set_image_classification_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS image_classification_sessions_updated_at
  ON image_classification_sessions;

CREATE TRIGGER image_classification_sessions_updated_at
  BEFORE UPDATE ON image_classification_sessions
  FOR EACH ROW EXECUTE FUNCTION set_image_classification_sessions_updated_at();

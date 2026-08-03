-- Cooperative cancellation: finish the in-flight row, then stop the run.
ALTER TABLE public.gallery_sessions
  ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS gallery_sessions_cancel_requested_idx
  ON public.gallery_sessions (id, workspace_id)
  WHERE cancel_requested = true;

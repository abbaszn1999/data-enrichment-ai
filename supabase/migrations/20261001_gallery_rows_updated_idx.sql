-- Delta polling reads rows changed since a cursor.
CREATE INDEX IF NOT EXISTS gallery_session_rows_updated_idx
  ON public.gallery_session_rows (session_id, updated_at);

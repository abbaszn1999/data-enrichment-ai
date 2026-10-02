-- The sheet view (filters, sort, search, tabs) a share link opens with.
-- Null means the link opens unfiltered, as before.
alter table public.share_links
  add column if not exists view jsonb;

-- The browser reads image_classification_sessions with select("*"), so the
-- model column must not carry a provider/model name.
alter table public.image_classification_sessions
  alter column model set default 'standard';

update public.image_classification_sessions
  set model = 'standard'
  where model is distinct from 'standard';

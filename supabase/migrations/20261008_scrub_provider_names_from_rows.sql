-- Rows written by older runs still carry provider/model names that reach the
-- browser in API responses. Only the exact phrases the app itself wrote are
-- rewritten; customer product text is left alone.

create or replace function pg_temp.scrub_notes(t text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    t,
    'Exact match\s*[^\sA-Za-z]{0,6}\s*Google AI Mode found the product link; GPT-[\d.]+ Sol confirmed it and pulled the images\.',
    'Exact match: the product page was confirmed and its images were taken from it.', 'g'),
    'SearchApi(\.io)?\s*', '', 'g'),
    '"Google AI Mode', '"The web search', 'g'),
    'Google AI Mode', 'the web search', 'g'),
    '\?utm_source=openai&', '?', 'g'),
    '[?&]utm_source=openai', '', 'g'),
    'GPT-[\d.]+ Sol', 'the AI agent', 'g')
$$;

create or replace function pg_temp.scrub_descriptions(t text) returns text language sql immutable as $$
  select replace(replace(t,
    ' using OpenAI web image search', ''),
    'Found with Google AI Mode', 'Found with web search')
$$;

update public.catalog_session_rows
  set enriched_data = pg_temp.scrub_notes(enriched_data::text)::jsonb
  where enriched_data::text ~ '(Google AI Mode|SearchApi|utm_source=openai|GPT-[0-9.]+ Sol)';

update public.catalog_session_rows
  set error_message = regexp_replace(error_message, '\s*(at\s+)?https?://\S*openai\S*?(?=[.,;)]?(\s|$))', '', 'gi')
  where error_message ~* 'https?://\S*openai';

update public.gallery_session_rows
  set data = replace(
    (data #- '{sourceMeta,model}' #- '{sourceMeta,plannerModel}')::text,
    '"openai-web-image-search-url-preview"', '"web-image-search-url-preview"')::jsonb
  where data->'sourceMeta' ?| array['model', 'plannerModel']
     or data::text like '%openai-web-image-search-url-preview%';

update public.job_runs
  set settings = pg_temp.scrub_descriptions(settings::text)::jsonb
  where settings::text ~ '(using OpenAI web image search|Found with Google AI Mode)';

update public.catalog_presets
  set payload = pg_temp.scrub_descriptions(payload::text)::jsonb
  where payload::text ~ '(using OpenAI web image search|Found with Google AI Mode)';

update public.workspaces
  set enrichment_presets = pg_temp.scrub_descriptions(enrichment_presets::text)::jsonb
  where enrichment_presets::text ~ '(using OpenAI web image search|Found with Google AI Mode)';

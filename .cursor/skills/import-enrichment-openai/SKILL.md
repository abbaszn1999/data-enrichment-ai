---
name: catalog-intelligence-openai
description: >-
  Catalog Intelligence AI-tab product enrichment via OpenAI Responses (one fixed agent: gpt-6.1-sol medium + web_search).
  Use when changing Catalog Intelligence enrich, /api/catalog-intelligence, src/lib/enrich,
  enrichment models, or replacing Gemini/Serper in the Catalog Intelligence AI path.
---

# Catalog Intelligence (OpenAI)

## Scope

- **In scope:** Catalog Intelligence → workspace sidebar **AI tab** only (`/api/catalog-intelligence`, `src/lib/enrich/*`).
- **Out of scope:** Functions tab, Store Assistant, Gallery/Visualizer/Classify.
- **Do not** use Gemini or Serper in the Catalog Intelligence enrich path.

## Contract

- **One** `POST https://api.openai.com/v1/responses` per product row (a failed attempt is retried once by the job).
- **One fixed agent** for Enrich mode: `gpt-6.1-sol`, `reasoning.effort: medium`, `search_context_size: medium`
  (constants `ENRICH_MODEL`, `ENRICH_REASONING_EFFORT`, `ENRICH_MAX_OUTPUT_TOKENS` in `src/lib/enrich/models.ts`).
  The stored `enrichmentModel` (standard / premium) is ignored by the generic path; there is no model selector.
- `max_output_tokens: 128000` (the model maximum) so many long columns never hit a small default.
  `status: incomplete` with `reason: max_output_tokens` throws `EnrichOutputTruncatedError`: billed, never retried,
  message tells the user to select fewer columns or shorten instructions.
- Hosted tool: `{ "type": "web_search" }` (not `web_search_preview`), `tool_choice: "required"` on every row.
- Prompt layout (`src/lib/enrich/prompt.ts`): the stable `instructions` hold the agent role/skills, language, rules, grounding
  and one numbered block per column with its **custom instruction**; the per-row `input` holds only the row fields
  and attached images. Custom instructions outrank the built-in brief, never the grounding rules.
- Structured output via `text.format` strict `json_schema` for **requested columns only**.
- Columns are instruction-only: label + optional custom instruction (no tone/length settings). Defaults: Title tag,
  Product description, Product specifications, FAQ section, Source URLs — each with an editable starting custom
  instruction; a new product sheet starts with only Source URLs switched on.
- **Source URLs is not an OpenAI column on product sheets.** `enrichRow` routes the column with id `sourceUrls`
  (by id, never by the `sourceUrls` type — Image sources `imageSourceUrls` shares the type) to
  `src/lib/enrich/source-urls/` (one Google AI Mode search via SearchApi with a tiny prompt that adapts to the input
  (text only: "find every web page that sells this exact product" + the row's fields; photo only: "identify the
  product in the attached photo, then find…"; both: fields + "the attached photo shows the same product"), plus the
  custom instruction if any, one photo max; asks for every kind of
  seller — manufacturer/brand site, Chinese factories and suppliers such as Alibaba/1688, wholesalers, retailers,
  marketplaces, any language — with a soft "aim for 10 or more"; no website rules — a safety cap of 15 links in code
  only; code-side link checks that also allow plain `http://` pages (opt-in `allowHttp`, Image Finder stays https
  only); a second search with new angles only when nothing was found). It is independent of Image Finder's strict Exact Match prompt. Alone it makes no OpenAI
  call; next to other columns the
  OpenAI call (without that column) and the Google call run in parallel and both costs go on the row's charge.
  If only the OpenAI half fails, the row's retry reuses the Google answer (`sourceUrlsMemo`, kept by
  `processCatalogRow`) so the search is never paid twice. A 429/5xx SearchApi answer (never billed) gets one more
  try. PLP sheets keep the OpenAI `sourceUrls` column.

## Sources

- Any column with data (sheet or AI column from any tool) can be a source. `src/lib/jobs/row-sources.ts` splits
  image columns (Image Finder output, image-named columns, extension-less CDN URLs) into `input_image` parts
  (cap 8, deduped); other columns are text (cap 4000 chars each). AI source columns reach the agent under their
  label (`sourceColumnLabels` from the browser, `"<label> (AI)"` when a sheet column has the same name); found
  pages read as `title (url)`. Links are never mined for product codes (`extractRowIdentifiers`).
- The sidebar sends only the sources it lists (sheet columns + AI columns with data on the active sheet); a preset
  may tick an AI column that is still empty here, and it stays ticked without being sent.

## Billing

- Credits per row are exact from OpenAI usage: `calculateOpenAiWebSearchCost` (tokens + `$0.01` per `search` call),
  summed across failed billed attempts, charged once per run and row (idempotent).

## Anti-hallucination (server-enforced)

- **Images:** `imageUrls` must be exact `image_result.image_url` values from the tool. Never accept `source_website_url` / HTML pages. Reject non-image URLs via `looksLikeDirectImageUrl`. Pad up to `imageCount` from the tool pool.
- **Sources:** Keep only URLs present in tool sources/citations.
- **Categories:** When a store allowlist is provided, `sanitizeCategoriesOutput` keeps only exact name/fullPath matches; inventing taxonomies → empty string. Prompt + schema require allowlist-only or `""`.

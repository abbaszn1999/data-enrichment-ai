---
name: catalog-intelligence-openai
description: >-
  Catalog Intelligence AI-tab product enrichment via OpenAI Responses (one fixed agent: gpt-6-sol medium + web_search).
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
- **One fixed agent** for Enrich mode: `gpt-6-sol`, `reasoning.effort: medium`, `search_context_size: medium`
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
  Product description, Product specifications, FAQ section.

## Sources

- Any column with data (sheet or AI column from any tool) can be a source. `src/lib/jobs/row-sources.ts` splits
  image columns (Image Finder output, image-named columns, extension-less CDN URLs) into `input_image` parts
  (cap 8, deduped); other columns are text (cap 4000 chars each).

## Billing

- Credits per row are exact from OpenAI usage: `calculateOpenAiWebSearchCost` (tokens + `$0.01` per `search` call),
  summed across failed billed attempts, charged once per run and row (idempotent).

## Anti-hallucination (server-enforced)

- **Images:** `imageUrls` must be exact `image_result.image_url` values from the tool. Never accept `source_website_url` / HTML pages. Reject non-image URLs via `looksLikeDirectImageUrl`. Pad up to `imageCount` from the tool pool.
- **Sources:** Keep only URLs present in tool sources/citations.
- **Categories:** When a store allowlist is provided, `sanitizeCategoriesOutput` keeps only exact name/fullPath matches; inventing taxonomies → empty string. Prompt + schema require allowlist-only or `""`.

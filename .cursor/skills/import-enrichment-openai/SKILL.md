---
name: import-enrichment-openai
description: >-
  Import AI-tab product enrichment via OpenAI Responses (Terra/Sol + web_search).
  Use when changing Import enrich, /api/enrich, src/lib/enrich, enrichment models,
  or replacing Gemini/Serper in the Import AI path.
---

# Import Enrichment (OpenAI)

## Scope

- **In scope:** Import → Enrich sidebar **AI tab** only (`/api/enrich`, `src/lib/enrich/*`).
- **Out of scope:** Functions tab, Sync agent, Gallery/Visualizer/Classify.
- **Do not** use Gemini or Serper in the Import enrich path.

## Contract

- **One** `POST https://api.openai.com/v1/responses` per product row.
- Models: Standard → `gpt-5.6-terra`, Premium → `gpt-5.6-sol`.
- Tier maps to `reasoning.effort` and `search_context_size`:
  - Standard: `medium` / `medium`
  - Premium: `high` / `high`
- Hosted tool: `{ "type": "web_search" }` (not `web_search_preview`).
- Structured output via `text.format` strict `json_schema` for **requested columns only**.

## Search policy

| Columns | tool_choice | search_content_types |
|---------|-------------|----------------------|
| Text / categories only | `auto` (search if identity weak) | text only |
| `sourceUrls` | `required` | text |
| `imageUrls` | `required` | `["image","text"]` + `image_settings` |
| Mixed | OR of rules | include image types if images requested |

## Anti-hallucination (server-enforced)

- **Images:** `imageUrls` must be exact `image_result.image_url` values from the tool. Never accept `source_website_url` / HTML pages. Reject non-image URLs via `looksLikeDirectImageUrl`. Pad up to `imageCount` from the tool pool.
- **Sources:** Keep only URLs present in tool sources/citations.
- **Categories:** When a store allowlist is provided, `sanitizeCategoriesOutput` keeps only exact name/fullPath matches; inventing taxonomies → empty string. Prompt + schema require allowlist-only or `""`.
- Do not invent product specs absent from row data or search results.

## Layout

```
src/lib/enrich/
  index.ts       public API
  types.ts       settings + OpenAI response shapes
  models.ts      tier → model / effort / context
  policy.ts      tool_choice + content types
  schema.ts      dynamic JSON schema
  prompt.ts      agent instructions (allowlist + image_url rules)
  categories.ts  store category allowlist sanitize
  parse.ts       merge structured output + tool results
  openai.ts      Responses client
  agent.ts       enrichProductRow orchestrator
```

## Credits

Price with `calculateOpenAiWebSearchCost`. Deduct via existing `/api/enrich` RPC (`ai_enrichment` / `import_row`).

---
name: sync-pro-openai-web
description: >-
  Sync Pro uses OpenAI Sol only for product image search (replacing Serper).
  Use when changing sync_images_search, Serper, or openai-web in Sync agent.
---

# Sync Pro — OpenAI images only

## Scope

- **In scope:** `sync_images_search` backend when mode is Pro.
- **Out of scope:** Text research, orchestrator, load/write/apply, Import enrich.

## Behavior

| Mode | Orchestrator | Text research (Globe) | Images (`sync_images_search`) |
|------|--------------|----------------------|-------------------------------|
| Fast | Gemini Flash | Gemini `googleSearch` | **Serper** |
| Pro | Gemini Pro | Gemini `googleSearch` (same) | **OpenAI Sol** + `web_search` images |

Flow for Pro images:

1. Gemini Pro calls `sync_catalog_lookup` for named products, then `sync_images_search`.
2. Runtime sends product fields to OpenAI Sol with hosted image web_search.
3. Sol returns `status` + `selectedImageUrl` (`string | null`). Runtime accepts the URL only if status is `found`, URL is a direct image URL, and it exactly matches a tool `image_result.image_url`.
4. Abstain only when results are clearly unrelated — not merely because there is no official brand packshot. Never invent URLs; never fall back to the first tool image without model selection.

## Catalog memory

- Prompt includes a tiered title-only `productDirectory` (orientation).
- Named products always require `sync_catalog_lookup` (full sheet) before writes.
- Multi-name instructions keep **all** mentioned titles (mention detection) — do not drop shorter names via relative score bands.
- Explicit `rowIndexes` from lookup beat instruction name extraction.
- Image tool returns `status: complete | partial | empty` with succeeded/failed titles; the agent must report those counts — never polish partial into full success.
- `sync_catalog_lookup` does not increment write `rowsAffected`.

## Globe

- Still gates **`sync_research_web` only** (Gemini grounding).
- Image search does **not** require Globe.

## Files

- `src/lib/sync/agent/openai-web.ts` — Sol image search + grounded selection
- `src/lib/sync/agent/ai-helpers.ts` — `searchImagesForRows` branches on mode
- `src/lib/sync/agent/injection-guards.ts` — tiered product directory
- `src/lib/sync/agent/image-target.ts` — `matchCatalogRows` / image row targeting
- `src/lib/sync/agent/tool-handlers.ts` — partial-success grounding for images/columns

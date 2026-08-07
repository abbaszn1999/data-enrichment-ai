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

1. Gemini Pro decides `sync_images_search`.
2. Runtime sends product fields to OpenAI Sol with hosted image web_search.
3. Accept only tool `image_result.image_url` (no page URLs / no Serper).
4. If none found → tool reports `imagesFound: 0`; agent tells the user no images were found.

## Globe

- Still gates **`sync_research_web` only** (Gemini grounding).
- Image search does **not** require Globe.

## Files

- `src/lib/sync/agent/openai-web.ts` — Sol image search only
- `src/lib/sync/agent/ai-helpers.ts` — `searchImagesForRows` branches on mode

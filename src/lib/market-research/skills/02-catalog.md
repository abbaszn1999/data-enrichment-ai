---
id: 02-catalog
stage: 2
thinking: medium
tools: [read_store_collections, match_catalog]
output: CatalogScopeOutput
---

# Stage 2 — Catalog Scope Selection

## Goal
Present the catalog structure clearly to the user, showing collection names, product counts, and parent niches, allowing the user to select specific collections or entire niches for market research.

## Rules
- Accurately calculate and display total unique products per broad niche.
- Validate the user's selected collections against the store catalog.
- Support selecting individual collections, multiple collections across niches, or all collections.
- Ensure the selected scope is confirmed before proceeding to seed generation.

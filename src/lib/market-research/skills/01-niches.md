---
id: 01-niches
stage: 1
thinking: high
tools: [read_store_collections, fetch_site_pages, propose_niches]
output: NichesOutput
---

# Stage 1 — Store Catalog Extractor & Niche Discovery

## Goal
Analyze the connected merchant website's navigation, categories, and collections to discover broad parent commercial niches and map every collection to its appropriate parent niche.

## Rules
- Only report niches backed by real products and collections that exist on the website.
- Never invent product counts or hallucinate non-existent collections.
- Group collections logically under high-level parent niches (e.g. Toys, Sunglasses, Eyeglasses, Watches, Apparel).
- If a store has only one broad niche, group all collections under that single parent niche.
- Deliver structured JSON output matching `NichesOutput` containing all discovered niches, mapped collections, and a professional executive summary.

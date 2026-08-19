---
id: 03-seeds
stage: 3
thinking: medium
tools: [generate_seeds, probe_demand]
output: SeedsOutput
---

# Stage 3 — Broad Niche Seed Variation Generation

## Goal
For each selected collection, define the canonical niche seed and generate 4-8 broad commercial search variations with accurate linguistic categorization.

## Rules
- Analyze the collection name, description, product count, and parent niche.
- Define the canonical niche seed (e.g., "Sunglasses").
- Generate variations: Primary term, Synonym, Broadened phrase, Plural/Singular, Regional terminology.
- Scope match classification: Exact, Close, Broader.
- STRICT NEGATIVE CONSTRAINTS:
  - DO NOT generate specific styles (e.g., Aviator sunglasses, Polarized sunglasses).
  - DO NOT generate brand names (e.g., Ray-Ban sunglasses).
  - DO NOT generate specific materials (e.g., Wood sunglasses).
  - DO NOT generate long-tail sub-niches (e.g., Fishing sunglasses).
- Each variation must be output in structured tabular rows matching `SeedsOutput`.

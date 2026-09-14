---
id: competitor-research
order: 2
thinking: low
output: "WrCompetitorNote: resolvedName, groupingModel, columnNotes, excludedFromNav, summary"
triggers:
  - "looking up one competitor's storefront navigation via web search"
not_for:
  - "copying a competitor's category names, wording, or brand into the header (structure only, never content)"
  - "electing this store's own entry points (that is skill 03, ia-planner)"
---

# Competitor Research — Navigation Pattern Extraction

You are researching how a named competitor storefront structures its header
navigation, using web search. You are not designing anything yet — you are
gathering structural inspiration for a separate planning step. This is a
single fast lookup, not a deep audit: read the storefront's real header (and
its open mega menu, if you can find a page/screenshot showing one), then
report facts, not opinions about the competitor's product.

## What to extract

Look past what individual categories are literally called — the point is the
**pattern**, not their words. For each competitor, work out:

1. **Grouping model** — the axis their top-level nav is organized around. Say
   which of these (or a mix) it is: gender, brand, use-case/occasion, product
   type/department, price tier, or something else. Name the axis, not their
   category labels.
2. **Column shape** — roughly how many columns their mega menu uses when
   open, and whether columns carry images/descriptions or are plain text
   lists.
3. **What they keep out of top nav** — the kind of long-tail/facet
   combinations you can tell are deliberately excluded from the header
   (visible only via on-page filters or search instead).

## Output format

Reply in exactly this five-line plain text format, nothing else, one line per
field, omitting a line's content (leaving it blank after the colon) only if
you truly could not determine it:

```
Name: <the store/brand's real name>
Grouping: <the grouping axis/axes their top nav uses>
Columns: <approximate column count and whether columns have images/descriptions>
Excluded: <the kind of long-tail/facet pages they keep out of top nav>
Summary: <2-3 sentences a header designer could act on>
```

## Rules

- This is structural inspiration only. Never reuse a competitor's category
  names, wording, tagline, or brand identity in anything downstream.
- If you cannot find their real navigation, say so plainly in `Summary`
  rather than guessing a generic structure.

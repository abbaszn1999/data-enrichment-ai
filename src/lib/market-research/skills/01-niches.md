---
id: 01-niches
version: 3.0.0
stage: 1
thinking: high
tools: [read_store_collections, read_store_brands, fetch_site_pages, propose_niches]
input_schema: NichesInput
output_schema: NichesOutput
triggers:
  - "Stage 1 of the Collection Builder"
  - "discover parent niches"
  - "map store collections to niches"
not_for:
  - "recommending which niche to dominate (that is a later stage)"
  - "generating keyword seeds or variations (Stage 3)"
  - "classifying keyword search intent (Stage 4)"
---

# Stage 1 — Store Catalog Extractor & Niche Discovery

## Goal

Read the merchant's entire existing catalog structure — every collection, category, and
brand/vendor PLP the storefront already has, exactly as it exists today — and organize all of it
into the small set of broad parent commercial niches the store actually sells in. Nothing is
invented, nothing is recommended yet. "Done" means every single input item is assigned to exactly
one broad parent niche, product counts roll up correctly, and a merchant reading the summary
immediately recognizes their own store.

This is the foundation of the whole Collection Builder pipeline. An inaccurate niche map here
corrupts every later stage — Stage 2 scope selection, Stage 3 seed generation, and everything
downstream inherits whatever grouping mistake happens here. Precision is worth more than speed.

---

## Input Context

You receive one flat list of items. Every item is real, selectable, and product-backed — there is
no separate "signal-only" input anymore. Items come in two kinds, distinguished only by `kind`:

| Field | Meaning |
|---|---|
| `id` | Unique item id |
| `name` | Display name, e.g. `"Educational Toys"` or `"Ray-Ban"` |
| `productCount` | Products currently inside it — a real count for both collections and brands |
| `description` | Optional description, when the store has one (brands rarely do) |
| `parentId` | **WooCommerce collections only.** The id of the direct parent category. Omitted for top-level categories, brand items, and always for Shopify. |
| `depth` | **WooCommerce collections only.** `0` = top-level category, `1` = subcategory, `2` = sub-subcategory. Always `0`/omitted for Shopify and for brand items. |
| `kind` | `"brand"` when this item is a brand/vendor PLP (a Shopify `vendor` filter page, or a WooCommerce brand taxonomy/attribute archive). **Omitted** for every normal collection/category. |

**Platform shapes differ on purpose:**
- **Shopify** — collections are flat. There is no `parentId` or `depth`; every collection is
  independent and manually or automatically curated.
- **WooCommerce** — categories are a real tree. `depth` and `parentId` tell you exactly where
  each category sits, and you must use that hierarchy, not re-derive it from the name.

**Brand/vendor PLPs (`kind: "brand"`) are a normal item, not a separate signal.** A brand page is
a real, selectable PLP on the store with its own real product count — it gets classified into a
niche and placed in `collectionIds` exactly like a collection. The only thing that's different
about it is *how* you figure out where it belongs (see below) and that its name can never become
the niche's own name.

---

## Step-by-Step Process

1. **Read every item** — collections, categories, and brand PLPs alike. Do not sample, cap, or
   skip any; every item must be assigned to a niche in the final output.
2. **Resolve the WooCommerce hierarchy first, if present.** For every collection with `depth > 0`,
   locate its ancestor chain via `parentId` up to the top-level (`depth === 0`) category. Decide
   the niche for the top-level ancestor, then carry that same niche down to every descendant.
   Brand items never have a `parentId` — skip this step for them.
3. **Classify each collection/category** into a broad commercial niche using its name and
   description first. When the name is generic or ambiguous, use nearby collections and any
   brand PLPs already resolved in that niche as a confirming signal (e.g. a generic "Accessories"
   collection sitting beside `Ray-Ban`/`Oakley`/`Maui Jim` confirms Eyewear).
4. **Classify each brand PLP (`kind: "brand"`) using your own knowledge of what that brand sells.**
   A brand's name carries no commercial-category signal by itself — `"Ray-Ban"` doesn't lexically
   say "eyewear." Use your general knowledge (you know Ray-Ban/Oakley/Maui Jim sell
   sunglasses/eyewear, LEGO/Hasbro/Mattel sell toys, Garmin/Casio sell watches/electronics, etc.)
   to place it. If you don't recognize a brand and nothing else on the store resolves it, place it
   under the store's largest/most dominant niche rather than inventing a niche for one brand.
5. **Merge into the smallest accurate set of broad parent niches.** A store selling only sunglasses
   and eyeglasses should produce one niche (`Eyewear`), not two.
6. **Aggregate product counts** per niche by summing every item (collections and brands alike)
   assigned to it — never estimate or round.
7. **Write the `agentConclusion`** as a short, natural, professional sentence a merchant would
   actually want to read — state the number of niches found and the total item count covered.

---

## Decision Rules

- **Single-niche stores.** If every item resolves to the same broad niche, output exactly one
  niche containing all of them. Do not invent a second niche to look more thorough.
- **Subcategories (WooCommerce, `depth > 0`).** Always inherit the niche of the top-level
  ancestor. Only break this rule when a subcategory is unmistakably a different commercial
  vertical from its parent with nothing in common (e.g. a `"Gift Cards"` subcategory under
  `"Toys"` — treat this as the rare exception, never the default assumption).
- **Ambiguous or generic collection names** (`"Accessories"`, `"Featured"`, `"New Arrivals"`,
  `"Sale"`). In this order: (a) check the description, (b) check which niche's items it sits
  beside in the same parent category, (c) check whether a nearby brand PLP confirms a niche,
  (d) if still unresolved, group it under the store's largest/most dominant niche rather than
  creating a vague catch-all niche.
- **Brand PLPs are classified by what they sell, not by wording.** Rely on your own knowledge of
  the brand's typical commercial category. Exactly like a collection, a brand PLP is a single item
  that lands in exactly one niche's `collectionIds` — never duplicate the same brand id into more
  than one niche, even for a brand that commercially spans multiple categories; pick its single
  most dominant/primary vertical on this store.
- **Multiple unrelated niches.** Real multi-vertical stores exist (e.g. Toys + Sunglasses +
  Watches on one storefront). Report every distinct niche you find; do not force unrelated
  verticals into one niche for tidiness.
- **Every item must land somewhere.** If a collection or brand genuinely fits nowhere, place it
  under the closest/largest existing niche rather than dropping it — never emit an
  "Uncategorized" niche unless truly nothing else fits and every other option has been exhausted.

---

## Strict Constraints — NEVER

- **NEVER** invent a collection, a brand, a product count, or a niche that isn't backed by the
  actual input data.
- **NEVER** use a brand/vendor name as a niche NAME — the niche name is always a generic
  commercial term (e.g. `"Eyewear"`), even when that niche is dominated by one or two brand PLPs.
  A brand's own item `name` inside `collectionIds` is unaffected by this — the brand item itself
  keeps its real name; only the *niche* name must stay generic.
- **NEVER** rename a brand PLP's `name`, alter its casing/spelling, or merge two different brands
  into one item.
- **NEVER** create a niche named after a WooCommerce subcategory when its parent category already
  defines the correct broad niche.
- **NEVER** recommend which niche the merchant should pursue or dominate — that decision belongs
  to a later stage. Stage 1 only organizes what already exists.
- **NEVER** leave an item unassigned in the final `structuredNiches` output — every input id
  (collection or brand) must appear in exactly one niche's `collectionIds`.
- **NEVER** split one obvious commercial niche into multiple near-duplicate niches (e.g.
  `"Sunglasses"` and `"Sun Glasses"` as two separate niches) — merge them.

---

## Output Contract

Strict JSON matching `NichesOutput`:

```json
{
  "niches": [
    {
      "id": "slug-id",
      "name": "Broad Parent Niche Name",
      "summary": "One sentence explaining what this broad parent space covers on the store.",
      "collectionIds": ["id1", "id2"]
    }
  ],
  "agentConclusion": "Conversational conclusion summary written in professional plain English."
}
```

| Field | Rule |
|---|---|
| `niches[].id` | URL-safe slug derived from the niche name |
| `niches[].name` | The broad commercial niche (e.g. `"Eyewear"`, `"Toys"`) — never a brand, never a subcategory name |
| `niches[].summary` | One factual sentence, no promotional language |
| `niches[].collectionIds` | Every item id (collection **or** brand) assigned to this niche — union across all niches must equal the full input item set exactly once each |
| `agentConclusion` | Plain English, states niche count and total item count, no niche recommendation |

The caller reconstructs each niche's full item list (including brand PLPs, each carrying its own
real `productCount`) from `collectionIds` — you never need a separate brands field.

---

## Quality Gates

Before returning, verify:

- [ ] Every input item id (collection or brand) appears in exactly one niche's `collectionIds` — no duplicates, no omissions.
- [ ] No niche NAME, `summary`, or `agentConclusion` sentence uses a brand/vendor name as the niche's own identity.
- [ ] Every brand PLP was placed using knowledge of what it commercially sells, not by matching its name against category keywords.
- [ ] No brand PLP id appears in more than one niche's `collectionIds` — exactly one niche each, same rule as collections.
- [ ] No WooCommerce subcategory (`depth > 0`) was placed in a different niche than its top-level ancestor, unless it is a genuine unrelated vertical.
- [ ] Product counts per niche equal the sum of every assigned item's `productCount` (collections and brands together) — no rounding, no invented numbers.
- [ ] `agentConclusion` names the niche count and total item count and makes no dominate/pursue recommendation.
- [ ] The niche set is the smallest accurate grouping — no near-duplicate niches for the same commercial concept.

---

## Error Handling & Fallbacks

- **No brand PLPs in the input.** Perfectly normal — most stores have no discoverable brand
  taxonomy. Classify by name, description, and hierarchy alone; do not treat their absence as a
  failure.
- **An unrecognized brand name.** If you have no knowledge of what a brand sells and nothing on
  the store disambiguates it, place it under the store's largest/most dominant niche rather than
  guessing a specific one or inventing a new niche for it.
- **No description on a collection.** Fall back to the name alone, then hierarchy position, then
  nearby items as a signal, in that order.
- **Malformed or missing hierarchy fields.** If `parentId` points to an id not present in the
  input, treat that collection as top-level (`depth = 0`) rather than failing.
- **Zero items.** Should not occur — the caller only invokes this skill with a non-empty catalog.
  If it ever happens, return an empty `niches` array with an `agentConclusion` stating nothing was
  found, rather than fabricating placeholder niches.

---

## Worked Examples

### Example A — Shopify (flat collections + brand PLPs classified by knowledge)

**Input:**
```json
{
  "storeName": "OpticWorld",
  "collections": [
    { "id": "col-001", "name": "Sunglasses", "productCount": 4200 },
    { "id": "col-002", "name": "Women's Sunglasses", "productCount": 2100 },
    { "id": "col-003", "name": "Eyeglasses", "productCount": 1650 },
    { "id": "col-004", "name": "Accessories", "productCount": 300 },
    { "id": "brand-ray-ban", "name": "Ray-Ban", "productCount": 1200, "kind": "brand" },
    { "id": "brand-oakley", "name": "Oakley", "productCount": 950, "kind": "brand" },
    { "id": "brand-maui-jim", "name": "Maui Jim", "productCount": 300, "kind": "brand" }
  ]
}
```

**Reasoning:** All four collection names point to one vertical. `"Accessories"` is generic on its
own, but sitting beside Sunglasses/Eyeglasses confirms it belongs to the same niche. `Ray-Ban`,
`Oakley`, and `Maui Jim` are recognized eyewear brands — classified into `Eyewear` by knowledge of
what they sell, not by matching their names against any keyword.

**Output:**
```json
{
  "niches": [
    {
      "id": "eyewear",
      "name": "Eyewear",
      "summary": "Covers sunglasses, eyeglasses, eyewear accessories, and brand PLPs sold on the store.",
      "collectionIds": [
        "col-001", "col-002", "col-003", "col-004",
        "brand-ray-ban", "brand-oakley", "brand-maui-jim"
      ]
    }
  ],
  "agentConclusion": "I identified 1 broad parent niche, Eyewear, covering all 7 collections and brand PLPs and 10,700 products on OpticWorld."
}
```

### Example B — WooCommerce (hierarchy inheritance + a cross-vertical brand)

**Input:**
```json
{
  "storeName": "ToyKingdom",
  "collections": [
    { "id": "12", "name": "Toys", "productCount": 3016, "depth": 0 },
    { "id": "34", "name": "Educational Toys", "productCount": 419, "parentId": "12", "depth": 1 },
    { "id": "35", "name": "Board Games", "productCount": 421, "parentId": "12", "depth": 1 },
    { "id": "36", "name": "Strategy Games", "productCount": 85, "parentId": "35", "depth": 2 },
    { "id": "20", "name": "Baby Products", "productCount": 870, "depth": 0 },
    { "id": "21", "name": "Baby Feeding", "productCount": 210, "parentId": "20", "depth": 1 },
    { "id": "brand-lego", "name": "LEGO", "productCount": 640, "kind": "brand" },
    { "id": "brand-fisher-price", "name": "Fisher-Price", "productCount": 210, "kind": "brand" }
  ]
}
```

**Reasoning:** `Educational Toys` (34) and `Board Games` (35) inherit the `Toys` (12) niche
directly. `Strategy Games` (36) is two levels deep under `Toys` via `Board Games` — it still
inherits `Toys`, never becomes its own niche. `Baby Feeding` (21) inherits `Baby Products` (20).
`LEGO` is known to sell only toys, so it's placed in `Toys`. `Fisher-Price` commercially sells
both toys and baby gear, but it still lands in exactly one niche, not both — its toy lineup is the
larger, more dominant part of its business, so it's placed in `Toys`.

**Output:**
```json
{
  "niches": [
    {
      "id": "toys",
      "name": "Toys",
      "summary": "Covers all toy categories including educational toys, board/strategy games, and toy brand PLPs.",
      "collectionIds": ["12", "34", "35", "36", "brand-lego", "brand-fisher-price"]
    },
    {
      "id": "baby-products",
      "name": "Baby Products",
      "summary": "Covers baby essentials including feeding products.",
      "collectionIds": ["20", "21"]
    }
  ],
  "agentConclusion": "I identified 2 broad parent niches, Toys and Baby Products, covering all 8 collections and brand PLPs and 5,871 products on ToyKingdom."
}
```

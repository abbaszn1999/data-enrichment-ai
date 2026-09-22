---
id: 03-seeds
version: 3.0.0
stage: 3
thinking: high
tools: [generate_seeds]
input_schema: SeedsInput
output_schema: SeedsOutput
triggers:
  - "Stage 3 of the Collection Builder"
  - "generate broad niche seed variations"
  - "expand selected collections into broad search terminology"
  - "extract entry-point terms for a PLP"
not_for:
  - "checking search volume, CPC, or demand (the next stage, run on these seeds)"
  - "generating long-tail, narrow, or sub-niche keywords (a later deep-research stage)"
  - "classifying keyword search intent (Stage 4)"
  - "recommending which niche or collection to pursue (Stage 1 already organized the catalog; this stage never ranks or advises)"
---

# Stage 3 — Broad Niche Seed Variation Generation

## Goal

The customer has already confirmed, in Stage 2, exactly which PLPs (categories, subcategories,
Shopify collections, and brand/vendor pages) they want researched. Your job is to reverse-engineer,
for each PLP, the small set of **entry-point anchor terms** that sit underneath virtually every
real search query a shopper would type for that exact page — the broad terms that will be checked
for search volume and demand in the next stage, and that every future long-tail keyword this
pipeline ever discovers for this PLP will trace back to.

"Done" means: every selected PLP has the right anchor terms — not synonyms of its title, not a
narrow slice of it, but the true recurring heads of its entire search space — written in that PLP's
own language, the total output never exceeds 100 rows across the whole run, and every term is
something a real shopper would actually search. Get the anchors wrong here — too narrow, too
generic, missing the brand when the PLP itself is brand-specific — and every downstream demand
check inherits the mistake, because the whole rest of the pipeline is built on top of these terms.

---

## The Golden Rule — Reverse-Engineer the Entry Point, Don't Paraphrase the Title

**A broad seed variation is not a synonym of the PLP's name. It is a head/anchor term that recurs
inside the vast majority of realistic search queries a shopper would type for that exact PLP —
including all the specific, narrow, long-tail ones you will never generate yourself.**

Think of it this way for every PLP you process:

1. **Simulate the query space.** Silently imagine dozens of realistic, specific things a real
   shopper searches for when they land on (or are looking for) exactly this PLP. Do not write these
   down — they are scaffolding for your own reasoning, never part of the output.
2. **Find the recurring heads.** Across that imagined space, identify the word or short phrase
   that keeps reappearing as the anchor every specific query is built around.
3. **Output only the anchors**, each tagged with how closely it matches the PLP's exact commercial
   scope.

This is the same mental move for every PLP, but the *shape* of the anchor changes with what kind of
PLP you're looking at:

- **Pure category PLP** (e.g. "Eyewear") — a shopper searching this page types things like "women
  eyewear", "mens sunglasses", "aviator glasses", "polarized shades". None of those words are fixed
  — the recurring heads are the plain category terms themselves: `eyewear`, `sunglasses`,
  `glasses`, `shades`. No brand is involved, so none is invented.
- **Brand-anchored PLP** (e.g. "Gucci Sunglasses" — a brand/vendor page or a brand-filtered
  category) — a shopper on this exact page types "gucci women eyewear", "mens gucci glasses",
  "gucci aviator sunglasses". Here the brand token is the one thing that is *fixed* in literally
  every real query for this specific PLP — dropping it produces a term ("sunglasses", "eyewear")
  that no longer belongs to this PLP's search space at all; it belongs to the generic Sunglasses
  PLP's space instead, which is a different page. The correct anchors combine the fixed brand token
  with the category head: `gucci sunglasses`, `gucci glasses`, `gucci shades`, `gucci eyewear`.
- **Function/benefit PLP** (e.g. "Eye Care") — a shopper types "best eye cream for dark circles",
  "caffeine eye serum", "cooling eye gel". The recurring heads are the product-type + function
  combinations, never the narrow modifiers: `eye cream`, `eye serum`, `eye gel`, `eye care`. Never
  `dark circles`, `caffeine`, or `cooling` — those are long-tail modifiers, not anchors.

Whichever shape applies, the test is always the same: **if you mentally attach almost any plausible
narrow modifier to this term, does it still read as a real, natural search query for this exact
PLP?** If yes, it's a valid anchor. If the anchor only makes sense stripped of something that was
actually fixed on the page (like a brand), it is not a valid anchor for this PLP — it's an anchor
for a *different* PLP.

---

## Input Context

You receive the customer's Stage 2 selection, already grouped at SUBCATEGORY granularity — the
level a Stage 1 taxonomy agent already classified as one real, distinct search intent (e.g. "Kids
Hats") — falling back to the flat CATEGORY alone only for legacy projects that predate the
subcategory tree. Exact shape:

```
Category: <category name>
Subcategory: <subcategory name> (<fully selected | partial selection> label)
PLPs:
  - id="<id>" name="<name>" (<productCount> products) — description: "<description>" — store path: <breadcrumb>
  ...
```

(When no subcategory tree exists for this project, the `Subcategory:` line is omitted and the
label appears directly on the `Category:` line instead — treat that category as the intent group.)

| Field | Meaning |
|---|---|
| `Category` | The broad commercial category this PLP lives in (e.g. "Clothing"). Context only — never the source of the canonical seed while a subcategory is available. |
| `Subcategory` | **The verified search-intent label** — a Stage 1 taxonomy agent already read this PLP's real name and its place in the client's own store hierarchy and decided this is the correct, Google-searchable intent for it (e.g. a client PLP literally named "Hats", nested under "Kids" in their own menu, was classified as "Kids Hats"). This is more reliable than the PLP's own raw `name` — **read it before the PLP name, not after.** |
| Fully selected / partial selection label | Applies to whichever group you're reading (subcategory, or category when no subcategory is given). `fully selected` — every PLP under that exact intent was chosen, full coverage of it is wanted. `partial selection` — the customer hand-picked only some PLPs out of a bigger group — stay scoped to just those PLPs. |
| `id` | The PLP's unique id — every output row must reference the same id it came from. |
| `name` | The PLP's own raw display name, in whatever language the merchant wrote it — this is the client's own label, not necessarily the searchable intent (a page named "Hats" doesn't tell you it's for kids; its subcategory does). Still useful for detecting the PLP's language/script, and as the fallback anchor source only when no subcategory is given. |
| `productCount` | Real product count behind that PLP today — carried through to every output row unchanged. |
| `description` | Optional. When present, read it before falling back to it as an anchor source — it often confirms whether a generic-sounding name is actually brand- or function-anchored. |
| `store path` | Optional. The client's own breadcrumb through their store hierarchy down to this PLP (e.g. "Kids > Hats"). Supporting evidence only — useful when the subcategory label alone still leaves ambiguity — never a substitute for the subcategory label itself. |

A PLP can be a normal category/collection or a brand/vendor page — you treat both with the exact
same reverse-engineering process. The only thing that changes is which *shape* of anchor (pure
category, brand-anchored, or function-anchored) the subcategory label (or, absent one, the PLP's
own name) tells you to produce.

---

## Step-by-Step Process

1. **Read the whole selection first**, before writing anything. Note the total PLP count — you
   will need it to budget your reasoning depth and the 100-row output ceiling (see Decision Rules).
2. **For each subcategory group** (or category group, when no subcategory is given), note whether
   it is `fully selected` or `partial selection` — this changes how liberally you lean into that
   exact intent's own generic broad term (see Decision Rules).
3. **For each PLP, read its subcategory label first, then classify its anchor shape:**
   - Does the subcategory label (or, absent one, the PLP's own name) contain a specific
     brand/vendor? → brand-anchored — the brand token is fixed.
   - Is it a generic commercial category? → pure category — no fixed token beyond the category itself.
   - Is it framed around a function, benefit, or use case (care, repair, cleaning, relief)? →
     function-anchored — the product-type + function combination is fixed.
   - Never classify from the raw PLP `name` alone while a subcategory label is available — a name
     like "Hats" is genuinely ambiguous on its own; its subcategory ("Kids Hats") already resolved
     that ambiguity using the client's own store hierarchy, so trust it.
4. **Detect the PLP's language/script** from its `name` (and `description`, if present). This is
   the language every one of its output anchors must be written in — no exceptions. The subcategory
   label decides *what* the anchor means; the PLP's own name/description still decides *what
   language and script* to write it in.
5. **Simulate that PLP's real query space** (silently, per the Golden Rule), anchored on the
   subcategory's intent, and extract the recurring anchor(s) — this is the `canonicalNicheSeed`, in
   the PLP's own language.
6. **Generate the broad seed variations** for that anchor: think as a real shopper searching
   Google, not as a thesaurus. Tag each with the correct `variationType` and `scopeMatch`.
7. **Budget as you go.** Running total across every PLP processed so far must stay on track to
   land at or under 100 by the time you finish the last PLP — but don't shortchange a small
   selection; see the budgeting rule below.
8. **Assemble the final JSON** — one entry per PLP, each carrying its own `collectionId`,
   `canonicalNicheSeed`, and its list of variations.

---

## Decision Rules

### Brand handling — fixed anchor vs. invented mention
- **If the selected PLP's own name already contains a brand/vendor** (a brand PLP, or a
  brand-filtered category like "Gucci Sunglasses"), that brand token is a **fixed anchor**, not an
  excludable brand mention. Every one of that PLP's variations should combine the brand token with
  the category head noun(s), exactly as a real shopper on that page would search.
- **If the selected PLP's own name does NOT contain a brand** (e.g. a generic "Sunglasses" or
  "Eyewear" PLP), never invent one. Do not add "Ray-Ban sunglasses" or any other brand as a
  variation under a generic category PLP — that brand belongs to a different PLP's search space,
  not this one.
- The rule is simple: **the PLP's own name is the source of truth for whether a brand belongs in
  its anchors.** Never subtract a brand that's there; never add one that isn't.

### Think like a real shopper on Google, not a thesaurus
- Every anchor and every variation must be something with genuine, everyday search behavior behind
  it — the words a real person actually types — not a technically-valid synonym nobody searches
  for. When in doubt between a "correct" dictionary word and the term shoppers actually use, choose
  the one shoppers use.
- Apply the Golden Rule's mental test before finalizing any term: attach a plausible narrow
  modifier to it and check that it still reads as a real query for this exact PLP.

### Language matching — per PLP, not per store
- Every broad seed variation for a PLP's canonical seed must be written in that PLP's own
  name/description language and script. An Arabic-named PLP gets an all-Arabic canonical seed and
  an all-Arabic variation family. An English-named PLP gets all-English. Never translate a PLP's
  output into a different language than the one the merchant used, and never transliterate
  (writing Arabic words in Latin letters, or vice versa) — write in the native script.
- A single Stage 3 run can legitimately produce mixed-language output when the selection itself
  mixes languages (e.g. a bilingual store with some Arabic-named categories and some English-named
  ones) — that is correct, not an error. Match language PLP by PLP, never pick one dominant
  language for the whole response.
- A brand token inside a brand-anchored PLP name usually stays in its own spelling regardless of
  the surrounding language (e.g. "Gucci" stays "Gucci" even inside an Arabic-language variation
  set) unless the store itself localizes the brand name — follow the PLP's own name as written.

### Fully selected vs. partial selection — judged at SUBCATEGORY granularity
This decision is made per subcategory group (the level that represents one real search intent),
not per category — a category can hold several unrelated subcategories, and a fully-selected
subcategory must never be treated as "partial" just because a sibling subcategory under the same
category wasn't also picked. Only fall back to category-level judgment when a project has no
subcategory tree at all.
- **Fully selected** — every PLP under that subcategory (or category, if no subcategory is given)
  was chosen. You may lean more liberally into that exact intent's own broad, generic market term
  as a `"Broader market term"` variation across several of its PLPs, since full coverage of it is
  clearly what the customer wants.
- **Partial selection** — only specific PLPs were hand-picked out of a bigger group. Stay tightly
  scoped to just those PLPs' own commercial meaning. Do not casually insert the whole group's
  generic term into every PLP's variation family — only include a broader term when it is a
  genuine, commonly-searched broadening of that specific PLP, and always label it `"Broader"`
  scope match so it is clearly distinguished from the PLP's exact meaning.

### The 100-row budget is a brainstorming depth budget, not a target to fill mechanically
- The total variation count across the ENTIRE response — every PLP combined — must never exceed
  100. But this is a ceiling on your output, not an instruction to always use it evenly:
  - **Few PLPs selected (1-10):** you have massive headroom — go deep. Fully brainstorm the anchor
    space for each PLP (up to 8-10 variations each) rather than settling for a shallow 3-4. A small
    selection deserves your fullest reasoning depth per PLP, not a token effort.
  - **Medium selections (11-30 PLPs):** 3-5 well-chosen variations per PLP.
  - **Large selections (30+ PLPs):** 2-3 variations per PLP, prioritizing only the highest-value
    anchors (the ones most central to that PLP's query space) per PLP.
- If the budget forces you to cut variations for a PLP, cut `"Ambiguous"` scope matches first,
  then `"Broader"`, keeping `"Exact"` and `"Close"` matches — those are the most useful anchors for
  the next stage's demand check.

### Canonical seed accuracy
- The canonical seed is always the true anchor for that PLP's search space, in the PLP's own
  language, following its anchor shape (pure category / brand-anchored / function-anchored) — never
  the store's own name, and never narrower than the PLP itself.
- **Fallback order when the PLP's own name is generic or ambiguous** (`"Hats"`, `"Accessories"`,
  `"New Arrivals"`, `"Featured"`): 1) its **subcategory label** first — that is exactly what it was
  invented to resolve (e.g. "Hats" → "Kids Hats"); 2) its `description`, when a subcategory isn't
  available or is itself still generic; 3) its parent category name as a last resort. Never skip
  straight from the PLP name to the category name while a subcategory label is sitting right there
  unused.

---

## Strict Constraints — NEVER

- **NEVER** generate specific styles, cuts, or product variants (e.g. "Aviator sunglasses",
  "Polarized sunglasses", "Cat-eye frames") — these are long-tail modifiers, not anchors, and
  belong to a later deep-research stage.
- **NEVER** invent a brand that is not already present in the selected PLP's own name — a generic
  "Sunglasses" PLP never gets "Ray-Ban sunglasses" as a variation.
- **NEVER** strip a brand that IS already present in the selected PLP's own name — a "Gucci
  Sunglasses" PLP's anchors must keep "Gucci" combined with the category head; producing only
  "Sunglasses"/"Eyewear" for a brand-anchored PLP is wrong, not neutral, because it silently
  reassigns the term to a different PLP's search space.
- **NEVER** generate specific materials, features, or audience-narrowing long-tail combinations
  (e.g. "Wooden educational toys", "Titanium frames", "Sunglasses for fishing", "Toys for
  three-year-olds", "Caffeine eye serum", "Eye cream for dark circles") — these are long-tail
  modifiers attached to an anchor, never the anchor itself.
- **NEVER** extract or reference individual SKU/product-level attributes.
- **NEVER** translate or transliterate a PLP's variations into a language different from that
  PLP's own name/description language.
- **NEVER** omit a selected PLP. Every input id must appear once as `collectionId`.
- **NEVER** invent a `collectionId` that was not in the input selection.
- **NEVER** let the total output across the whole response exceed 100 rows.
- **NEVER** settle for a shallow, low-effort variation set when few PLPs are selected and the
  100-row budget leaves ample room to go deeper.
- **NEVER** invent a canonical seed or variation not grounded in the PLP's real name, description,
  or genuine everyday search behavior for that commercial space.
- **NEVER** recommend which niche or PLP the customer should pursue — that decision belongs to a
  later stage; this stage only prepares terms for a demand check.

---

## Output Contract

Strict JSON matching `SeedsOutput`:

```json
{
  "collections": [
    {
      "collectionId": "id-from-input",
      "canonicalNicheSeed": "Canonical Niche Seed",
      "variations": [
        {
          "term": "Broad Seed Variation Term",
          "variationType": "Primary term",
          "scopeMatch": "Exact"
        }
      ]
    }
  ]
}
```

| Field | Rule |
|---|---|
| `collections[].collectionId` | Must exactly match an `id` from the input selection — one entry per selected PLP. |
| `collections[].canonicalNicheSeed` | The true anchor term for that PLP's search space, in the PLP's own language, following its anchor shape (pure category / brand-anchored / function-anchored). |
| `collections[].variations[].term` | One broad seed anchor, in the same language as the PLP's canonical seed. |
| `collections[].variations[].variationType` | One of: `Primary term`, `Common synonym`, `Alternative wording`, `Phrase variation`, `Spelling variation`, `Regional terminology`, `Singular variation`, `Audience variation`, `Broader market term`. |
| `collections[].variations[].scopeMatch` | One of: `Exact`, `Close`, `Broader`, `Ambiguous`. |

The caller fills in `selectedCollection`, `broadParentNiche`, and `productCount` for each row from
the original input — you never need to repeat them in your output.

---

## Quality Gates

Before returning, verify:

- [ ] Every selected PLP `id` from the input has a matching entry in `collections` — no PLP was
      skipped.
- [ ] For every term, the Golden Rule test passes: attach a plausible narrow modifier to it and it
      still reads as a real, natural query for THIS exact PLP — not a different, more generic PLP.
- [ ] Every brand-anchored PLP (brand present in its own name) kept that brand combined with the
      category head in every variation. Every non-brand PLP invented none.
- [ ] Every variation for a given PLP is written in that PLP's own name/description language and
      script — no translation, no transliteration, no mixed languages within one PLP's family.
- [ ] The total variation count across the entire response is 100 or fewer.
- [ ] Small selections (few PLPs) received genuinely deep brainstorming, not a shallow minimum.
- [ ] No variation is a style, material, feature, function-modifier, audience-narrowing
      combination, or SKU-level attribute — only anchors, never the long-tail built on top of them.
- [ ] Every PLP's anchor shape and canonical seed were read from its subcategory label first —
      never derived from a generic/ambiguous raw PLP name while a subcategory label was available.
- [ ] `fully selected` subcategories (or categories, when no subcategory tree exists) were treated
      more liberally toward that intent's own broad term than `partial selection` groups, without
      over-generalizing either — and this was judged at subcategory granularity, not leaked up from
      or down to a sibling subcategory under the same category.
- [ ] No niche or PLP was recommended, ranked, or endorsed — this stage only prepares terms.

---

## Error Handling & Fallbacks

- **A PLP has no description.** Fall back to its subcategory label first (if given), then its name
  alone, then its parent category name, to infer the anchor — this is normal, not a failure.
- **A generic/ambiguous PLP name with no subcategory label, no description, and an unhelpful
  parent category name.** Use the parent category name itself as the canonical seed rather than
  inventing a specific-sounding term that isn't backed by the input. This should be rare — it only
  happens when a project predates the subcategory tree entirely.
- **Unsure whether a name token is a real brand or just a descriptive word.** If you recognize it
  as a real commercial brand/vendor, treat it as a fixed anchor per the brand-handling rule. If you
  do not recognize it as a brand, treat the PLP as a pure category or function-anchored PLP instead
  — do not guess a brand into existence.
- **The selection is large enough that even 2-3 variations per PLP would exceed 100.** Prioritize
  the PLPs with the highest `productCount` for the fuller variation sets; give the smallest/lowest
  -count PLPs just their `"Primary term"` entry to stay within budget.
- **A PLP's language is unclear or mixed within its own name** (e.g. a name mixing two scripts).
  Match the dominant script of that specific PLP's name; do not default to English.
- **Zero PLPs in the input.** Should not occur — the caller only invokes this skill with a
  non-empty Stage 2 selection. If it ever happens, return an empty `collections` array rather than
  fabricating placeholder PLPs.

---

## Worked Examples

### Example A — Pure category PLP (Eyewear)

**Input:**
```
Category: Eyewear
Subcategory: Eyewear (fully selected — every PLP under this subcategory was chosen, this exact search intent is fully in scope)
PLPs:
  - id="col-eye" name="Eyewear" (6,800 products)
```

**Reasoning:** No brand in the name — pure category. Simulated query space: "women eyewear", "mens
sunglasses", "aviator glasses", "polarized shades", "reading glasses"... The recurring heads are
the plain category terms. Only one PLP selected, so go deep (8+ variations) per the budgeting rule.

**Output:**
```json
{
  "collections": [
    {
      "collectionId": "col-eye",
      "canonicalNicheSeed": "Eyewear",
      "variations": [
        { "term": "Eyewear", "variationType": "Primary term", "scopeMatch": "Exact" },
        { "term": "Sunglasses", "variationType": "Common synonym", "scopeMatch": "Close" },
        { "term": "Glasses", "variationType": "Common synonym", "scopeMatch": "Close" },
        { "term": "Shades", "variationType": "Alternative wording", "scopeMatch": "Close" },
        { "term": "Eye glasses", "variationType": "Alternative wording", "scopeMatch": "Close" },
        { "term": "Spectacles", "variationType": "Regional terminology", "scopeMatch": "Close" },
        { "term": "Eyeglasses", "variationType": "Spelling variation", "scopeMatch": "Close" },
        { "term": "Optical wear", "variationType": "Broader market term", "scopeMatch": "Broader" }
      ]
    }
  ]
}
```

---

### Example B — Brand-anchored PLP (Gucci Sunglasses)

**Input:**
```
Category: Eyewear Brands
Subcategory: Gucci (partial selection — only some PLPs under this subcategory were chosen, stay scoped to them)
PLPs:
  - id="brand-gucci" name="Gucci Sunglasses" (640 products)
```

**Reasoning:** "Gucci" is a real, recognized brand present in the PLP's own name — it is a fixed
anchor, not an excludable brand mention. Simulated query space: "gucci women eyewear", "mens gucci
glasses", "gucci aviator sunglasses". The recurring heads all combine the fixed brand token with a
category head noun — none of them drop "Gucci", because doing so would describe the generic
Sunglasses PLP, not this one.

**Output:**
```json
{
  "collections": [
    {
      "collectionId": "brand-gucci",
      "canonicalNicheSeed": "Gucci Sunglasses",
      "variations": [
        { "term": "Gucci sunglasses", "variationType": "Primary term", "scopeMatch": "Exact" },
        { "term": "Gucci glasses", "variationType": "Common synonym", "scopeMatch": "Close" },
        { "term": "Gucci shades", "variationType": "Common synonym", "scopeMatch": "Close" },
        { "term": "Gucci eyewear", "variationType": "Broader market term", "scopeMatch": "Broader" }
      ]
    }
  ]
}
```

---

### Example C — Function/benefit PLP (Eye Care)

**Input:**
```
Category: Skincare
Subcategory: Eye Care (partial selection — only some PLPs under this subcategory were chosen, stay scoped to them)
PLPs:
  - id="col-eyecare" name="Eye Care" (980 products) — description: "Creams, serums and treatments for the eye area"
```

**Reasoning:** No brand in the name. The description confirms this is a function/benefit category,
not a single product type. Simulated query space: "best eye cream for dark circles", "caffeine eye
serum", "cooling eye gel", "anti-aging eye treatment". The recurring heads are product-type +
function combinations — never the narrow modifiers ("dark circles", "caffeine", "cooling",
"anti-aging").

**Output:**
```json
{
  "collections": [
    {
      "collectionId": "col-eyecare",
      "canonicalNicheSeed": "Eye Care",
      "variations": [
        { "term": "Eye cream", "variationType": "Primary term", "scopeMatch": "Exact" },
        { "term": "Eye serum", "variationType": "Common synonym", "scopeMatch": "Exact" },
        { "term": "Eye gel", "variationType": "Common synonym", "scopeMatch": "Exact" },
        { "term": "Eye care", "variationType": "Alternative wording", "scopeMatch": "Exact" },
        { "term": "Eye treatment", "variationType": "Broader market term", "scopeMatch": "Broader" }
      ]
    }
  ]
}
```

---

### Example D — English, partial selection out of a bigger category (Board Games)

**Input:**
```
Category: Toys
Subcategory: Board Games (partial selection — only some PLPs under this subcategory were chosen, stay scoped to them)
PLPs:
  - id="35" name="Board Games" (421 products)
```

**Reasoning:** Only the "Board Games" subcategory was picked from the larger Toys category — the
customer did not select "All Toys" or "Educational Toys". Stay scoped to board games specifically;
do not casually add the whole "Toys" category as a broader term the way full-selection groups do —
only include a genuinely common broadening if it exists, clearly labeled `"Broader"`.

**Output:**
```json
{
  "collections": [
    {
      "collectionId": "35",
      "canonicalNicheSeed": "Board Games",
      "variations": [
        { "term": "Board games", "variationType": "Primary term", "scopeMatch": "Exact" },
        { "term": "Board game", "variationType": "Singular variation", "scopeMatch": "Exact" },
        { "term": "Tabletop games", "variationType": "Common synonym", "scopeMatch": "Close" },
        { "term": "Table games", "variationType": "Alternative wording", "scopeMatch": "Ambiguous" }
      ]
    }
  ]
}
```

---

### Example E — Arabic PLP, language matching

**Input:**
```
Category: نظارات
Subcategory: نظارات شمسية (fully selected — every PLP under this subcategory was chosen, this exact search intent is fully in scope)
PLPs:
  - id="col-9" name="نظارات شمسية" (3,500 products)
```

**Reasoning:** The PLP name is written in Arabic and is a pure category (no brand). Every variation
for its canonical seed must stay in Arabic — no English translation, no Latin-letter
transliteration. Think about how an Arabic-speaking shopper actually searches Google for
sunglasses.

**Output:**
```json
{
  "collections": [
    {
      "collectionId": "col-9",
      "canonicalNicheSeed": "نظارات شمسية",
      "variations": [
        { "term": "نظارات شمسية", "variationType": "Primary term", "scopeMatch": "Exact" },
        { "term": "نظاره شمسيه", "variationType": "Spelling variation", "scopeMatch": "Exact" },
        { "term": "نظارات شمس", "variationType": "Alternative wording", "scopeMatch": "Close" },
        { "term": "نظارات", "variationType": "Broader market term", "scopeMatch": "Broader" }
      ]
    }
  ]
}
```

---

### Example F — Subcategory resolves an ambiguous raw PLP name (Kids Hats)

**Input:**
```
Category: Clothing
Subcategory: Kids Hats (fully selected — every PLP under this subcategory was chosen, this exact search intent is fully in scope)
PLPs:
  - id="hats-123" name="Hats" (150 products) — store path: Kids > Hats
```

**Reasoning:** The PLP's own raw name is just "Hats" — genuinely ambiguous on its own; it could mean
hats for anyone. Its subcategory label, "Kids Hats", already resolved that: a Stage 1 taxonomy
agent read this PLP's real position in the client's own store menu (the "store path" confirms it
sits under "Kids") and correctly classified it as a kids-specific search intent. Per the
fallback-order rule, the subcategory label is read BEFORE the raw PLP name — the canonical seed is
"Kids Hats", never bare "Hats". Simulated query space: "kids hats", "toddler hats", "children's
hats", "boys hats", "girls hats". No brand present — pure category, but the anchor itself must
carry "kids", not just the bare product type.

**Output:**
```json
{
  "collections": [
    {
      "collectionId": "hats-123",
      "canonicalNicheSeed": "Kids Hats",
      "variations": [
        { "term": "Kids hats", "variationType": "Primary term", "scopeMatch": "Exact" },
        { "term": "Children's hats", "variationType": "Common synonym", "scopeMatch": "Exact" },
        { "term": "Toddler hats", "variationType": "Audience variation", "scopeMatch": "Close" },
        { "term": "Kids caps", "variationType": "Alternative wording", "scopeMatch": "Close" },
        { "term": "Hats", "variationType": "Broader market term", "scopeMatch": "Broader" }
      ]
    }
  ]
}
```

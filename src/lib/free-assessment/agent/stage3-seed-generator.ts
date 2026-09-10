import type {
  MockSeedRow,
  ScopeMatch,
  VariationType,
} from "@/components/free-assessment/mock-data";
import { runGeminiMarketResearch } from "./gemini-runner";

export type SelectedScopeCollectionInput = {
  id: string;
  name: string;
  description?: string;
  productCount: number;
  parentNicheName: string;
  /**
   * True when every PLP under this item's parent niche was selected in
   * Stage 2 (the whole niche was picked as a unit), false/undefined when
   * only specific PLPs within a bigger niche were chosen.
   */
  nicheFullySelected?: boolean;
};

export type Stage3SeedGeneratorResult = {
  seedRows: MockSeedRow[];
  isAiGenerated: boolean;
};

/** Hard ceiling on total broad seed variations returned per Stage 3 run. */
const MAX_TOTAL_SEED_ROWS = 100;

const VALID_VARIATION_TYPES: VariationType[] = [
  "Primary term",
  "Common synonym",
  "Alternative wording",
  "Phrase variation",
  "Spelling variation",
  "Regional terminology",
  "Singular variation",
  "Audience variation",
  "Broader market term",
];

const VALID_SCOPE_MATCHES: ScopeMatch[] = [
  "Exact",
  "Close",
  "Broader",
  "Ambiguous",
];

/** Lower = kept first when the total exceeds MAX_TOTAL_SEED_ROWS. */
const SCOPE_MATCH_TRIM_PRIORITY: Record<ScopeMatch, number> = {
  Exact: 0,
  Close: 1,
  Broader: 2,
  Ambiguous: 3,
};

function normalizeVariationType(val: string): VariationType {
  const match = VALID_VARIATION_TYPES.find(
    (t) => t.toLowerCase() === val.toLowerCase()
  );
  return match ?? "Common synonym";
}

function normalizeScopeMatch(val: string): ScopeMatch {
  const match = VALID_SCOPE_MATCHES.find(
    (m) => m.toLowerCase() === val.toLowerCase()
  );
  return match ?? "Close";
}

/**
 * Defensive safety net only — the prompt already instructs the model to
 * budget its own output to <= MAX_TOTAL_SEED_ROWS. If it ever overshoots,
 * keep the most useful rows (Exact/Close scope matches) before Broader/
 * Ambiguous ones, preserving each collection's original row order.
 */
function capTotalSeedRows(rows: MockSeedRow[]): MockSeedRow[] {
  if (rows.length <= MAX_TOTAL_SEED_ROWS) return rows;
  const withIndex = rows.map((row, index) => ({ row, index }));
  withIndex.sort((a, b) => {
    const pa = SCOPE_MATCH_TRIM_PRIORITY[a.row.scopeMatch];
    const pb = SCOPE_MATCH_TRIM_PRIORITY[b.row.scopeMatch];
    if (pa !== pb) return pa - pb;
    return a.index - b.index;
  });
  return withIndex.slice(0, MAX_TOTAL_SEED_ROWS).map((w) => w.row);
}

/**
 * Renders the selection in the human-readable, niche-grouped shape the
 * agent should reason over: every PLP under a niche that was selected in
 * full is grouped with a "fully selected" label so the model knows the
 * customer wants full-niche coverage; PLPs picked out of a bigger niche are
 * grouped with a "partial selection" label so the model stays tightly
 * scoped to just those PLPs rather than assuming the whole niche is wanted.
 */
function formatSelectionForPrompt(
  selectedCollections: SelectedScopeCollectionInput[]
): string {
  const order: string[] = [];
  const groups = new Map<
    string,
    { fullySelected: boolean; items: SelectedScopeCollectionInput[] }
  >();

  for (const item of selectedCollections) {
    const key = item.parentNicheName;
    if (!groups.has(key)) {
      groups.set(key, { fullySelected: Boolean(item.nicheFullySelected), items: [] });
      order.push(key);
    }
    groups.get(key)!.items.push(item);
  }

  return order
    .map((nicheName) => {
      const group = groups.get(nicheName)!;
      const label = group.fullySelected
        ? "fully selected — every PLP under this niche was chosen, full-niche coverage is wanted"
        : "partial selection — only these specific PLPs were chosen out of a bigger niche, stay scoped to them";
      const plpLines = group.items
        .map((item) => {
          const desc = item.description ? ` — description: "${item.description}"` : "";
          return `  - id="${item.id}" name="${item.name}" (${item.productCount.toLocaleString()} products)${desc}`;
        })
        .join("\n");
      return `Niche: ${nicheName} (${label})\nPLPs:\n${plpLines}`;
    })
    .join("\n\n");
}

interface GeminiSeedsResponse {
  collections: Array<{
    collectionId: string;
    canonicalNicheSeed: string;
    variations: Array<{
      term: string;
      variationType: string;
      scopeMatch: string;
    }>;
  }>;
}

export async function runStage3SeedGeneration(input: {
  storeName: string;
  selectedCollections: SelectedScopeCollectionInput[];
}): Promise<Stage3SeedGeneratorResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || input.selectedCollections.length === 0) {
    return runHeuristicStage3SeedGeneration(input);
  }

  const systemInstruction = `You are the Market Research Stage 3 Broad Niche Seed Variation Agent powered by Gemini 3.7 Flash.
Your job is to analyze the commercial catalog PLPs (collections/categories/brand pages) selected by the user and generate a structured family of broad niche seed variations for each one.

## Input shape
The selection is grouped by niche. Each niche group is labeled either:
- "fully selected" — every PLP under that niche was chosen, so full-niche coverage is wanted. You
  may lean more liberally into that niche's own generic broad market term across its PLPs.
- "partial selection" — only specific PLPs were hand-picked out of a bigger niche. Stay tightly
  scoped to just those PLPs; do not assume the customer wants the whole niche's generic terms.

## THE GOLDEN RULE — reverse-engineer the entry point, don't paraphrase the title
A broad seed variation is NOT a synonym of the PLP's name. It is a head/anchor term that recurs
inside the vast majority of realistic search queries a shopper would type for that exact PLP,
including every specific long-tail one you will never generate yourself.

Process for every PLP:
1. Silently simulate dozens of realistic, specific searches a shopper would type for exactly this
   PLP (never write these down — they are scaffolding for your own reasoning only).
2. Find the word or short phrase that recurs as the anchor every specific query is built around.
3. Output only that anchor and its close variants — never the narrow modifiers around it.

The SHAPE of the anchor depends on what the PLP's own name tells you it is:
- **Pure category** (e.g. "Eyewear"): no fixed token besides the category itself. Anchors:
  "eyewear", "sunglasses", "glasses", "shades".
- **Brand-anchored** (e.g. "Gucci Sunglasses" — a brand/vendor PLP or a brand-filtered category):
  the brand token is FIXED in every real query for this exact page. Anchors combine the brand with
  the category head: "gucci sunglasses", "gucci glasses", "gucci shades", "gucci eyewear" — never
  strip the brand down to bare "sunglasses"/"eyewear", because that describes a DIFFERENT PLP.
- **Function/benefit** (e.g. "Eye Care"): anchors are product-type + function combinations ("eye
  cream", "eye serum", "eye gel", "eye care") — never the narrow modifier riding on top of them
  ("eye cream for dark circles", "caffeine eye serum" — those are long-tail, not anchors).

Self-check before finalizing any term: attach a plausible narrow modifier to it — does it still
read as a real, natural query for THIS exact PLP? If the term only works stripped of something
that was actually fixed on the page (like a brand), it belongs to a different PLP, not this one.

## Brand handling — fixed anchor vs. invented mention
- If the selected PLP's own name already contains a real brand/vendor, that brand is a FIXED
  anchor — keep it combined with the category head in every variation for that PLP.
- If the selected PLP's own name does NOT contain a brand, never invent one as a variation.
- The PLP's own name is the sole source of truth for whether a brand belongs in its anchors: never
  subtract one that's there, never add one that isn't.

## Search like a real human, not a thesaurus
For every anchor, think about how an actual shopper types into Google/a search engine when looking
for that exact commercial space — not a mechanical list of dictionary synonyms. Prioritize terms
with real, everyday search behavior behind them over technically-correct but rarely-searched
wording.

## Language matching — CRITICAL
Each PLP's own name (and description, if present) is written in a specific language/script by the
merchant. Every broad seed variation you generate for that PLP's canonical seed family MUST be in
that exact same language/script — never translate into English, never transliterate, never mix
languages within one PLP's variation set. A PLP named in Arabic gets an all-Arabic variation
family; a PLP named in English gets an all-English family; a mixed-language selection produces
mixed-language output, matched per PLP, not one language for the whole response.

## For each selected PLP
1. Classify its anchor shape first (pure category / brand-anchored / function-anchored), then
   define the "canonicalNicheSeed" — the true anchor for this PLP's search space, in the SAME
   language as the PLP's own name (e.g. "Sunglasses", "Gucci Sunglasses", "Eye Care",
   "نظارات شمسية").
2. Generate broad seed variations — the anchors and their close variants, per the Golden Rule
   above, never a mechanical dictionary-synonym list.
   Allowed variation types:
   - "Primary term"
   - "Common synonym"
   - "Alternative wording"
   - "Phrase variation"
   - "Spelling variation"
   - "Regional terminology"
   - "Singular variation"
   - "Audience variation"
   - "Broader market term"

   Allowed scope matches:
   - "Exact"
   - "Close"
   - "Broader"
   - "Ambiguous"

## Global output budget — a brainstorming depth budget, not a flat quota
The TOTAL number of variations across every PLP in your response must never exceed 100, but this
is a ceiling, not an instruction to fill it evenly. Few PLPs selected (1-10) = go deep, fully
brainstorm each PLP's anchor space (up to 8-10 variations each) rather than a shallow 3-4. Medium
selections (11-30 PLPs) = 3-5 each. Large selections (30+) = 2-3 each, keeping only the highest
-value anchors. Never apply a flat rule regardless of count — count first, then divide the budget.

STRICT NEGATIVE CONSTRAINTS:
- DO NOT generate specific styles (e.g. Aviator sunglasses, Polarized sunglasses, Cat-eye frames).
- DO NOT invent a brand name that is not already present in the selected PLP's own name (e.g. do
  not add "Ray-Ban sunglasses" under a generic "Sunglasses" PLP).
- DO NOT strip a brand that IS already present in the selected PLP's own name — a "Gucci
  Sunglasses" PLP's anchors must keep "Gucci" combined with the category head.
- DO NOT generate specific materials (e.g. Wooden toys, Titanium frames, Leather straps).
- DO NOT generate long-tail sub-niches or narrow modifiers (e.g. Sunglasses for fishing, STEM robot
  kits for toddlers, Caffeine eye serum, Eye cream for dark circles).
- DO NOT extract individual SKU/product level attributes.
- DO NOT translate or transliterate a PLP's variations into a different language than its own name.
- DO NOT exceed the 100-total-row budget.
- DO NOT settle for a shallow variation set when few PLPs are selected and the budget allows depth.

Output strictly valid JSON with this exact schema:
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
}`;

  const userPrompt = `Store Name: ${input.storeName}
Selected PLPs (${input.selectedCollections.length} total), grouped by niche:

${formatSelectionForPrompt(input.selectedCollections)}

Generate the broad seed variations for each PLP according to the Golden Rule, the brand-anchor
handling rule, the language-matching requirement, the 100-term total budget, and the negative
constraints.`;

  try {
    const result = await runGeminiMarketResearch<GeminiSeedsResponse>({
      stage: 3,
      systemInstruction,
      userPrompt,
    });

    const parsed = result.data;
    if (parsed && Array.isArray(parsed.collections) && parsed.collections.length > 0) {
      const colMap = new Map<string, SelectedScopeCollectionInput>(
        input.selectedCollections.map((c) => [c.id, c])
      );

      const seedRows: MockSeedRow[] = [];

      for (const item of parsed.collections) {
        const sourceCol =
          colMap.get(item.collectionId) ||
          input.selectedCollections.find(
            (c) => c.name.toLowerCase() === item.canonicalNicheSeed.toLowerCase()
          ) ||
          input.selectedCollections[0];

        const canonical = item.canonicalNicheSeed || sourceCol.name;

        if (Array.isArray(item.variations) && item.variations.length > 0) {
          for (let i = 0; i < item.variations.length; i++) {
            const v = item.variations[i];
            seedRows.push({
              id: `${sourceCol.id}-gemini-${i + 1}-${slugifyTerm(v.term)}`,
              collectionId: sourceCol.id,
              broadSeedVariation: v.term,
              canonicalNicheSeed: canonical,
              selectedCollection: sourceCol.name,
              broadParentNiche: sourceCol.parentNicheName,
              productCount: sourceCol.productCount,
              variationType: normalizeVariationType(v.variationType),
              scopeMatch: normalizeScopeMatch(v.scopeMatch),
            });
          }
        }
      }

      if (seedRows.length > 0) {
        return {
          seedRows: capTotalSeedRows(seedRows),
          isAiGenerated: true,
        };
      }
    }
  } catch (error) {
    console.error("[runStage3SeedGeneration] Gemini 3.7 Flash seed call failed:", error);
  }

  return runHeuristicStage3SeedGeneration(input);
}

function slugifyTerm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function runHeuristicStage3SeedGeneration(input: {
  storeName: string;
  selectedCollections: SelectedScopeCollectionInput[];
}): Stage3SeedGeneratorResult {
  const seedRows: MockSeedRow[] = [];

  for (const col of input.selectedCollections) {
    const canonical = col.name;
    const lower = col.name.toLowerCase();

    // Generate primary canonical row
    seedRows.push({
      id: `${col.id}-seed-1`,
      collectionId: col.id,
      broadSeedVariation: canonical,
      canonicalNicheSeed: canonical,
      selectedCollection: col.name,
      broadParentNiche: col.parentNicheName,
      productCount: col.productCount,
      variationType: "Primary term",
      scopeMatch: "Exact",
    });

    if (lower.includes("sunglass")) {
      seedRows.push(
        {
          id: `${col.id}-seed-2`,
          collectionId: col.id,
          broadSeedVariation: "Sun Glasses",
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Spelling variation",
          scopeMatch: "Exact",
        },
        {
          id: `${col.id}-seed-3`,
          collectionId: col.id,
          broadSeedVariation: "Shades",
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Common synonym",
          scopeMatch: "Close",
        },
        {
          id: `${col.id}-seed-4`,
          collectionId: col.id,
          broadSeedVariation: "Eyewear",
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Broader market term",
          scopeMatch: "Broader",
        }
      );
    } else if (lower.includes("toy") || lower.includes("game")) {
      seedRows.push(
        {
          id: `${col.id}-seed-2`,
          collectionId: col.id,
          broadSeedVariation: canonical.replace(/toys/i, "games"),
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Common synonym",
          scopeMatch: "Close",
        },
        {
          id: `${col.id}-seed-3`,
          collectionId: col.id,
          broadSeedVariation: `Kids ${canonical}`,
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Audience variation",
          scopeMatch: "Close",
        },
        {
          id: `${col.id}-seed-4`,
          collectionId: col.id,
          broadSeedVariation: "Children Play Toys",
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Alternative wording",
          scopeMatch: "Close",
        }
      );
    } else {
      seedRows.push(
        {
          id: `${col.id}-seed-2`,
          collectionId: col.id,
          broadSeedVariation: `All ${canonical}`,
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Phrase variation",
          scopeMatch: "Exact",
        },
        {
          id: `${col.id}-seed-3`,
          collectionId: col.id,
          broadSeedVariation: `${col.parentNicheName} ${canonical}`,
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Alternative wording",
          scopeMatch: "Close",
        },
        {
          id: `${col.id}-seed-4`,
          collectionId: col.id,
          broadSeedVariation: col.parentNicheName,
          canonicalNicheSeed: canonical,
          selectedCollection: col.name,
          broadParentNiche: col.parentNicheName,
          productCount: col.productCount,
          variationType: "Broader market term",
          scopeMatch: "Broader",
        }
      );
    }
  }

  return {
    seedRows: capTotalSeedRows(seedRows),
    isAiGenerated: false,
  };
}

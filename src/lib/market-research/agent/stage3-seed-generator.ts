import type {
  MockSeedRow,
  ScopeMatch,
  VariationType,
} from "@/components/market-research/mock-data";
import { runGeminiMarketResearch } from "./gemini-runner";

export type SelectedScopeCollectionInput = {
  id: string;
  name: string;
  description?: string;
  productCount: number;
  parentNicheName: string;
};

export type Stage3SeedGeneratorResult = {
  seedRows: MockSeedRow[];
  isAiGenerated: boolean;
};

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
Your job is to analyze the commercial catalog collections selected by the user and generate a structured family of broad niche seed variations for each collection.

For each selected collection:
1. Define the most accurate "canonicalNicheSeed" (the standardized commercial name for this niche, e.g. "Sunglasses", "Educational Toys", "Wrist Watches").
2. Generate 4 to 8 broad seed variations representing the same or closely related broad market terminology.
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

STRICT NEGATIVE CONSTRAINTS:
- DO NOT generate specific styles (e.g. Aviator sunglasses, Polarized sunglasses, Cat-eye frames).
- DO NOT generate brand names (e.g. Ray-Ban sunglasses, Lego sets, Rolex watches).
- DO NOT generate specific materials (e.g. Wooden toys, Titanium frames, Leather straps).
- DO NOT generate long-tail sub-niches (e.g. Sunglasses for fishing, STEM robot kits for toddlers).
- DO NOT extract individual SKU/product level attributes.

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
Selected Collections:
${JSON.stringify(input.selectedCollections, null, 2)}

Generate the broad seed variations for each collection according to the rules and negative constraints.`;

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
          seedRows,
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
    seedRows,
    isAiGenerated: false,
  };
}

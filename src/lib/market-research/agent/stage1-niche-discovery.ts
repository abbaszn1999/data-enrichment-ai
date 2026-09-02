import type {
  MockCollection,
  MockNiche,
  NicheReading,
} from "@/components/market-research/mock-data";
import type { StoreCollectionItem } from "./store-catalog";
import { compressCollectionsForStage1 } from "./stage1-catalog";
import { runGeminiMarketResearch } from "./gemini-runner";

export type Stage1DiscoveryResult = {
  niches: NicheReading[];
  structuredNiches: MockNiche[];
  agentConclusion: string;
  beats: Array<{ at: number; text: string }>;
  isAiGenerated: boolean;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "niche";
}

interface GeminiNichesResponse {
  niches: Array<{
    id?: string;
    name: string;
    summary?: string;
    collectionIds: string[];
  }>;
  agentConclusion: string;
}

export async function runStage1NicheDiscovery(input: {
  storeName: string;
  collections: StoreCollectionItem[];
}): Promise<Stage1DiscoveryResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || input.collections.length === 0) {
    return runHeuristicStage1Discovery(input);
  }

  const compressed = compressCollectionsForStage1(input.collections);
  const catalogSummary = compressed.kept;

  const systemInstruction = `You are the Market Research Store Discovery Agent powered by Gemini 3.7 Flash.
Your job is Stage 1 of the Collection Builder:
1. Analyze the existing website navigation, categories, and collections of the client's store (${input.storeName}).
2. Identify the broad parent niches represented on the website (e.g. Eyewear, Toys, Baby Products, Sports Equipment, Watches, Electronics, Apparel, Home Decor, etc.).
3. Group each provided collection under exactly one of these identified broad parent niches.
4. Calculate or aggregate the total product count under each parent niche.
5. Write a concise, natural spoken conclusion in plain English.
   Important: At Stage 1, DO NOT recommend which niche to dominate yet. Only identify and organize the broad catalog areas that currently exist on the website.

Output strictly valid JSON with this exact schema:
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
}`;

  const overflowLine =
    compressed.overflowCount > 0
      ? `\nPlus ${compressed.overflowCount} smaller collections (${compressed.overflowProducts} products) omitted from this list — map only the collections given; leftover live collections are assigned in code by name.`
      : "";

  const userPrompt = `Store Name: ${input.storeName}
Existing Collections (${input.collections.length} total, showing the ${catalogSummary.length} largest by product count):
${JSON.stringify(catalogSummary, null, 2)}
${overflowLine}

Identify the broad parent niches and group the provided collections under them.`;

  try {
    const result = await runGeminiMarketResearch<GeminiNichesResponse>({
      stage: 1,
      systemInstruction,
      userPrompt,
    });

    const parsed = result.data;
    if (parsed && Array.isArray(parsed.niches) && parsed.niches.length > 0) {
      const collectionsMap = new Map<string, StoreCollectionItem>(
        input.collections.map((c) => [c.id, c])
      );

      const assignedCollectionIds = new Set<string>();

      const structuredNiches: MockNiche[] = parsed.niches.map((n, idx) => {
        const nicheId = n.id ? slugify(n.id) : slugify(n.name || `niche-${idx + 1}`);
        const nicheCollections: MockCollection[] = (n.collectionIds || [])
          .map((cid) => {
            const found = collectionsMap.get(cid);
            if (!found) return null;
            assignedCollectionIds.add(cid);
            return {
              id: found.id,
              name: found.name,
              productCount: found.productCount,
              description: found.description || undefined,
              plpPath: found.plpPath || undefined,
            };
          })
          .filter(Boolean) as MockCollection[];

        const productCount = nicheCollections.reduce(
          (sum, c) => sum + c.productCount,
          0
        );

        return {
          id: nicheId,
          name: n.name,
          productCount,
          collections: nicheCollections,
        };
      });

      // Catch any collections that weren't assigned
      const unassigned = input.collections.filter(
        (c) => !assignedCollectionIds.has(c.id)
      );

      if (unassigned.length > 0) {
        if (structuredNiches.length > 0) {
          const first = structuredNiches[0];
          for (const u of unassigned) {
            first.collections.push({
              id: u.id,
              name: u.name,
              productCount: u.productCount,
              description: u.description || undefined,
              plpPath: u.plpPath || undefined,
            });
            first.productCount += u.productCount;
          }
        } else {
          structuredNiches.push({
            id: "all-catalog",
            name: "Catalog Collections",
            productCount: unassigned.reduce((s, c) => s + c.productCount, 0),
            collections: unassigned.map((u) => ({
              id: u.id,
              name: u.name,
              productCount: u.productCount,
              description: u.description || undefined,
              plpPath: u.plpPath || undefined,
            })),
          });
        }
      }

      // Build simplified NicheReading for UI progress
      const nichesReadings: NicheReading[] = structuredNiches.map((sn, idx) => {
        const matchingParsed = parsed.niches[idx];
        const summary =
          matchingParsed?.summary ||
          `Covers ${sn.collections.length} collections with ${sn.productCount.toLocaleString()} items.`;

        return {
          id: sn.id,
          name: sn.name,
          summary,
        };
      });

      const totalCollectionsCount = input.collections.length;
      const totalNichesCount = structuredNiches.length;

      const beats = [
        { at: 1200, text: `Connecting to ${input.storeName} storefront...` },
        { at: 2800, text: `Extracted ${totalCollectionsCount} active collections and categories.` },
        { at: 4500, text: `Identified ${totalNichesCount} parent niches with Gemini 3.7 Flash.` },
        { at: 6000, text: `Catalog grouped. Ready for scope selection.` },
      ];

      return {
        niches: nichesReadings,
        structuredNiches,
        agentConclusion:
          parsed.agentConclusion ||
          `I analyzed ${input.storeName}'s catalog across ${totalCollectionsCount} collections and grouped them into ${totalNichesCount} distinct broad parent niches. In the next step, select which collections you want to research.`,
        beats,
        isAiGenerated: true,
      };
    }
  } catch (error) {
    console.error("[runStage1NicheDiscovery] Gemini 3.7 Flash call failed:", error);
  }

  return runHeuristicStage1Discovery(input);
}

export function runHeuristicStage1Discovery(input: {
  storeName: string;
  collections: StoreCollectionItem[];
}): Stage1DiscoveryResult {
  const collectionList = input.collections;
  const groups = new Map<string, StoreCollectionItem[]>();

  for (const c of collectionList) {
    const lower = c.name.toLowerCase();
    let groupKey = "General Catalog";

    if (
      lower.includes("sunglass") ||
      lower.includes("eyeglass") ||
      lower.includes("eyewear") ||
      lower.includes("frame") ||
      lower.includes("shade")
    ) {
      groupKey = "Eyewear";
    } else if (
      lower.includes("toy") ||
      lower.includes("game") ||
      lower.includes("puzzle") ||
      lower.includes("educational") ||
      lower.includes("kid")
    ) {
      groupKey = "Toys & Games";
    } else if (
      lower.includes("watch") ||
      lower.includes("timepiece") ||
      lower.includes("strap") ||
      lower.includes("horology")
    ) {
      groupKey = "Watches";
    } else if (
      lower.includes("shoe") ||
      lower.includes("sneaker") ||
      lower.includes("boot") ||
      lower.includes("footwear")
    ) {
      groupKey = "Footwear";
    } else if (
      lower.includes("shirt") ||
      lower.includes("dress") ||
      lower.includes("hoodie") ||
      lower.includes("jacket") ||
      lower.includes("pant") ||
      lower.includes("apparel") ||
      lower.includes("cloth")
    ) {
      groupKey = "Apparel";
    } else if (
      lower.includes("phone") ||
      lower.includes("audio") ||
      lower.includes("headphone") ||
      lower.includes("speaker") ||
      lower.includes("cable") ||
      lower.includes("electronic")
    ) {
      groupKey = "Electronics";
    } else if (
      lower.includes("home") ||
      lower.includes("kitchen") ||
      lower.includes("decor") ||
      lower.includes("lamp") ||
      lower.includes("furniture")
    ) {
      groupKey = "Home & Living";
    } else if (
      lower.includes("sport") ||
      lower.includes("fitness") ||
      lower.includes("gym") ||
      lower.includes("workout")
    ) {
      groupKey = "Sports & Fitness";
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(c);
  }

  const structuredNiches: MockNiche[] = [];
  const nichesReadings: NicheReading[] = [];

  for (const [groupName, items] of groups.entries()) {
    const nicheId = slugify(groupName);
    const uniqueProducts = items.reduce((sum, item) => sum + item.productCount, 0);

    const mockCollections: MockCollection[] = items.map((c) => ({
      id: c.id,
      name: c.name,
      productCount: c.productCount,
      description: c.description || undefined,
      plpPath: c.plpPath || undefined,
    }));

    structuredNiches.push({
      id: nicheId,
      name: groupName,
      productCount: uniqueProducts,
      collections: mockCollections,
    });

    nichesReadings.push({
      id: nicheId,
      name: groupName,
      summary: `Broad store catalog area covering ${mockCollections.length} collections (${uniqueProducts} products).`,
    });
  }

  const beats = [
    { at: 1000, text: `Connecting to ${input.storeName} catalog...` },
    { at: 2500, text: `Indexed ${collectionList.length} collections across navigation structure.` },
    { at: 4200, text: `Organized into ${structuredNiches.length} parent niches.` },
    { at: 5500, text: `Ready for Stage 2 catalog scope selection.` },
  ];

  return {
    niches: nichesReadings,
    structuredNiches,
    agentConclusion: `I identified ${structuredNiches.length} parent niches covering all ${collectionList.length} collections from ${input.storeName}. You can now review these niches and select the exact collections to include in your market research.`,
    beats,
    isAiGenerated: false,
  };
}

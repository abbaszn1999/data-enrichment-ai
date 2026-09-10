import type {
  MockCollection,
  MockNiche,
  NicheReading,
} from "@/components/free-assessment/mock-data";
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

function toMockCollection(item: StoreCollectionItem): MockCollection {
  return {
    id: item.id,
    name: item.name,
    productCount: item.productCount,
    description: item.description || undefined,
    plpPath: item.plpPath || undefined,
    ...(item.kind === "brand" ? { kind: "brand" as const } : {}),
  };
}

export async function runStage1NicheDiscovery(input: {
  storeName: string;
  collections: StoreCollectionItem[];
  /**
   * Every brand/vendor PLP on the store (Shopify `vendor` pages or the
   * WooCommerce brand taxonomy/attribute archives), each already shaped as a
   * full `StoreCollectionItem` with `kind: "brand"` and a real product
   * count. Merged straight into the working collection list below — a brand
   * is classified into a niche exactly like any other collection, never
   * treated as a separate "signal-only" input.
   */
  storeBrands?: StoreCollectionItem[];
}): Promise<Stage1DiscoveryResult> {
  const allItems: StoreCollectionItem[] = [
    ...input.collections,
    ...(input.storeBrands ?? []),
  ];

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || allItems.length === 0) {
    return runHeuristicStage1Discovery(input);
  }

  // Brand PLPs are compressed together with regular collections so a store
  // with hundreds of vendor pages still gets a bounded payload, and so the
  // "largest by product count" ranking below considers both fairly.
  const compressed = compressCollectionsForStage1(allItems);
  const catalogSummary = compressed.kept;

  const systemInstruction = `You are the Market Research Store Discovery Agent powered by Gemini 3.7 Flash.
Your job is Stage 1 of the Collection Builder:
1. Analyze the existing website navigation, categories, collections, and brand/vendor PLPs of the client's store (${input.storeName}).
2. Identify the broad parent niches represented on the website (e.g. Eyewear, Toys, Baby Products, Sports Equipment, Watches, Electronics, Apparel, Home Decor, etc.).
3. Group each provided item under exactly one of these identified broad parent niches.
4. Calculate or aggregate the total product count under each parent niche.
5. Write a concise, natural spoken conclusion in plain English.
   Important: At Stage 1, DO NOT recommend which niche to dominate yet. Only identify and organize the broad catalog areas that currently exist on the website.

## Catalog hierarchy (WooCommerce only)
Each collection carries "depth" (0 = top-level category, 1 = subcategory, 2 = sub-subcategory) and
"parentId" (the id of its direct parent, omitted for top-level items and always omitted for Shopify).
- Never create a niche named after a subcategory. A subcategory (depth > 0) belongs under the same
  broad parent niche as its top-level ancestor unless it is unmistakably a distinct commercial vertical
  that has nothing to do with its parent (rare — treat this as the exception, not the default).
- Shopify stores have no hierarchy: every collection is flat and depth is always 0.

## Brand/vendor PLPs — just another item to classify
Some items carry "kind": "brand". These are real store pages (a Shopify vendor filter page, or a
WooCommerce brand taxonomy/attribute archive) — not a commercial category — but you classify them
into "collectionIds" exactly like any other item, with one difference in HOW you decide where they go:
- A category/collection's OWN name and description tell you its niche.
- A brand's name does not describe a niche by itself — you must use your own general knowledge of what
  that brand/vendor commercially sells (e.g. you know "Ray-Ban" and "Oakley" sell sunglasses/eyewear,
  "LEGO" sells toys, "Garmin" sells watches/electronics) to decide which niche it belongs to.
- If you do not recognize a brand and no other signal on the store resolves it, place it under the
  store's largest/most dominant niche rather than inventing a new niche for one unrecognized brand.
- A brand's presence next to other collections can still help confirm an otherwise generic collection
  name (e.g. an "Accessories" collection sitting beside Ray-Ban/Oakley/Maui Jim confirms Eyewear).
- NEVER use a brand name as the niche NAME. The niche name is always a generic commercial term (e.g.
  "Eyewear"), even when that niche is dominated by one or two brand PLPs.

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
Existing Collections, Categories and Brand/Vendor PLPs (${allItems.length} total, showing the ${catalogSummary.length} largest by product count — items with "kind": "brand" are brand/vendor pages):
${JSON.stringify(catalogSummary, null, 2)}
${overflowLine}

Identify the broad parent niches and group every item (including brand/vendor PLPs) under them.`;

  try {
    const result = await runGeminiMarketResearch<GeminiNichesResponse>({
      stage: 1,
      systemInstruction,
      userPrompt,
    });

    const parsed = result.data;
    if (parsed && Array.isArray(parsed.niches) && parsed.niches.length > 0) {
      const itemsMap = new Map<string, StoreCollectionItem>(
        allItems.map((c) => [c.id, c])
      );

      const assignedIds = new Set<string>();

      const structuredNiches: MockNiche[] = parsed.niches.map((n, idx) => {
        const nicheId = n.id ? slugify(n.id) : slugify(n.name || `niche-${idx + 1}`);
        const nicheCollections: MockCollection[] = (n.collectionIds || [])
          .map((cid) => {
            const found = itemsMap.get(cid);
            if (!found) return null;
            assignedIds.add(cid);
            return toMockCollection(found);
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

      // Catch any items (collections or brand PLPs) that weren't assigned.
      const unassigned = allItems.filter((c) => !assignedIds.has(c.id));

      if (unassigned.length > 0) {
        if (structuredNiches.length > 0) {
          const first = structuredNiches[0];
          for (const u of unassigned) {
            first.collections.push(toMockCollection(u));
            first.productCount += u.productCount;
          }
        } else {
          structuredNiches.push({
            id: "all-catalog",
            name: "Catalog Collections",
            productCount: unassigned.reduce((s, c) => s + c.productCount, 0),
            collections: unassigned.map(toMockCollection),
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

      const totalItemsCount = allItems.length;
      const totalNichesCount = structuredNiches.length;

      const beats = [
        { at: 1200, text: `Connecting to ${input.storeName} storefront...` },
        { at: 2800, text: `Extracted ${totalItemsCount} active collections, categories and brand PLPs.` },
        { at: 4500, text: `Identified ${totalNichesCount} parent niches with Gemini 3.7 Flash.` },
        { at: 6000, text: `Catalog grouped. Ready for scope selection.` },
      ];

      return {
        niches: nichesReadings,
        structuredNiches,
        agentConclusion:
          parsed.agentConclusion ||
          `I analyzed ${input.storeName}'s catalog across ${totalItemsCount} collections and grouped them into ${totalNichesCount} distinct broad parent niches. In the next step, select which collections you want to research.`,
        beats,
        isAiGenerated: true,
      };
    }
  } catch (error) {
    console.error("[runStage1NicheDiscovery] Gemini 3.7 Flash call failed:", error);
  }

  return runHeuristicStage1Discovery(input);
}

function classifyCollectionNameHeuristically(name: string): string {
  const lower = name.toLowerCase();

  if (
    lower.includes("sunglass") ||
    lower.includes("eyeglass") ||
    lower.includes("eyewear") ||
    lower.includes("frame") ||
    lower.includes("shade")
  ) {
    return "Eyewear";
  }
  if (
    lower.includes("toy") ||
    lower.includes("game") ||
    lower.includes("puzzle") ||
    lower.includes("educational") ||
    lower.includes("kid")
  ) {
    return "Toys & Games";
  }
  if (
    lower.includes("watch") ||
    lower.includes("timepiece") ||
    lower.includes("strap") ||
    lower.includes("horology")
  ) {
    return "Watches";
  }
  if (
    lower.includes("shoe") ||
    lower.includes("sneaker") ||
    lower.includes("boot") ||
    lower.includes("footwear")
  ) {
    return "Footwear";
  }
  if (
    lower.includes("shirt") ||
    lower.includes("dress") ||
    lower.includes("hoodie") ||
    lower.includes("jacket") ||
    lower.includes("pant") ||
    lower.includes("apparel") ||
    lower.includes("cloth")
  ) {
    return "Apparel";
  }
  if (
    lower.includes("phone") ||
    lower.includes("audio") ||
    lower.includes("headphone") ||
    lower.includes("speaker") ||
    lower.includes("cable") ||
    lower.includes("electronic")
  ) {
    return "Electronics";
  }
  if (
    lower.includes("home") ||
    lower.includes("kitchen") ||
    lower.includes("decor") ||
    lower.includes("lamp") ||
    lower.includes("furniture")
  ) {
    return "Home & Living";
  }
  if (
    lower.includes("sport") ||
    lower.includes("fitness") ||
    lower.includes("gym") ||
    lower.includes("workout")
  ) {
    return "Sports & Fitness";
  }

  return "General Catalog";
}

export function runHeuristicStage1Discovery(input: {
  storeName: string;
  collections: StoreCollectionItem[];
  storeBrands?: StoreCollectionItem[];
}): Stage1DiscoveryResult {
  const collectionList = input.collections;
  const brandItems = input.storeBrands ?? [];
  const byId = new Map(collectionList.map((c) => [c.id, c]));
  const groupKeyById = new Map<string, string>();

  // A subcategory (depth > 0) must land in the same group as its top-level
  // ancestor — classifying "Board Games" and "Strategy Games" independently
  // by name would otherwise fragment one WooCommerce category tree into two
  // unrelated niches. Shopify collections have no parentId, so they always
  // fall straight through to name-based classification below. Brand PLPs
  // are handled separately (see below) since a brand's own name carries no
  // lexical niche signal for a keyword-matching heuristic to key off.
  function resolveGroupKey(item: StoreCollectionItem, guard: number): string {
    const cached = groupKeyById.get(item.id);
    if (cached) return cached;

    if (guard < 25 && item.parentId && item.parentId !== "0") {
      const parent = byId.get(item.parentId);
      if (parent) {
        const inherited = resolveGroupKey(parent, guard + 1);
        groupKeyById.set(item.id, inherited);
        return inherited;
      }
    }

    const groupKey = classifyCollectionNameHeuristically(item.name);
    groupKeyById.set(item.id, groupKey);
    return groupKey;
  }

  // Resolve top-level items first so subcategories always inherit an already
  // -settled ancestor group rather than racing the recursion.
  const sortedByDepth = [...collectionList].sort(
    (a, b) => (a.depth ?? 0) - (b.depth ?? 0)
  );
  for (const item of sortedByDepth) {
    resolveGroupKey(item, 0);
  }

  const groups = new Map<string, StoreCollectionItem[]>();
  for (const c of collectionList) {
    const groupKey = groupKeyById.get(c.id) ?? "General Catalog";
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(c);
  }

  // Without an LLM there is no reliable way to look up what a brand name
  // commercially sells — "Ray-Ban" gives a keyword-matcher nothing to key
  // off. Every brand PLP is routed into the store's single largest/most
  // dominant niche group instead of guessing, mirroring the skill's rule for
  // any item that resolves nowhere else. A single-niche store makes this
  // unambiguous by construction; only a genuine multi-niche store relies on
  // the "largest" tie-break, and it errs toward the safest available guess.
  if (brandItems.length > 0) {
    let dominantKey: string | null = null;
    let dominantTotal = -1;
    for (const [key, items] of groups.entries()) {
      const total = items.reduce((s, item) => s + item.productCount, 0);
      if (total > dominantTotal) {
        dominantTotal = total;
        dominantKey = key;
      }
    }
    if (!dominantKey) {
      dominantKey = "General Catalog";
      groups.set(dominantKey, []);
    }
    groups.get(dominantKey)!.push(...brandItems);
  }

  const structuredNiches: MockNiche[] = [];
  const nichesReadings: NicheReading[] = [];

  for (const [groupName, items] of groups.entries()) {
    const nicheId = slugify(groupName);
    const uniqueProducts = items.reduce((sum, item) => sum + item.productCount, 0);
    const mockCollections: MockCollection[] = items.map(toMockCollection);

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

  const totalItemsCount = collectionList.length + brandItems.length;

  const beats = [
    { at: 1000, text: `Connecting to ${input.storeName} catalog...` },
    { at: 2500, text: `Indexed ${totalItemsCount} collections and brand PLPs across navigation structure.` },
    { at: 4200, text: `Organized into ${structuredNiches.length} parent niches.` },
    { at: 5500, text: `Ready for Stage 2 catalog scope selection.` },
  ];

  return {
    niches: nichesReadings,
    structuredNiches,
    agentConclusion: `I identified ${structuredNiches.length} parent niches covering all ${totalItemsCount} collections from ${input.storeName}. You can now review these niches and select the exact collections to include in your market research.`,
    beats,
    isAiGenerated: false,
  };
}

import type {
  MockCollection,
  MockExcludedItem,
  MockNiche,
  MockSubcategory,
  NicheReading,
} from "@/components/market-research/mock-data";
import type { StoreCollectionItem } from "./store-catalog";
import { prepareStage1Catalog } from "./stage1-catalog";
import { runGeminiMarketResearch } from "./gemini-runner";
import {
  batchCandidates,
  detectOutputLanguage,
  verifyAssignmentCoverage,
  routeMissingToUnresolved,
  normalizeAssignments,
  enforceWooParentPrimacy,
  computeSkuTotals,
  indexCandidatesById,
} from "./taxonomy-build";
import type {
  ExcludedItem,
  TaxonomyAssignment,
  TaxonomyCandidate,
  TaxonomyPassAOutput,
  TaxonomyPassBOutput,
  TaxonomyTree,
} from "./taxonomy-types";

export type Stage1DiscoveryResult = {
  /** Legacy flattened view — kept so Tab 1/2 and every downstream stage
   *  keep working unchanged until they read `taxonomy` directly. Built from
   *  `taxonomy` when a fresh discovery ran; only includes each subcategory's
   *  PRIMARY member(s), so it never double-counts an overlap the taxonomy
   *  engine already resolved. Non-primary duplicates and excluded PLPs are
   *  omitted here (they are not lost — see `taxonomy.assignments`/`excluded`)
   *  until Tab 1/2 render the tree directly. */
  niches: NicheReading[];
  structuredNiches: MockNiche[];
  /** The new searchable category/subcategory tree. Present on every fresh
   *  Gemini-backed discovery; absent on the heuristic fallback and on
   *  projects persisted before this rewrite. */
  taxonomy?: TaxonomyTree;
  /** Non-taxonomic PLPs the agent excluded (promotional, attribute-only,
   *  duplicate, empty, unresolved) — visible in Tab 2, never selectable,
   *  zero SKUs. Present alongside `taxonomy` on a fresh Gemini-backed run. */
  excludedItems?: MockExcludedItem[];
  agentConclusion: string;
  beats: Array<{ at: number; text: string }>;
  isAiGenerated: boolean;
};

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "niche"
  );
}

function toMockCollection(item: {
  id: string;
  name: string;
  productCount: number;
  description?: string;
  plpPath?: string;
  kind?: "collection" | "brand";
  taxonomyPath?: string[];
}): MockCollection {
  return {
    id: item.id,
    name: item.name,
    productCount: item.productCount,
    description: item.description || undefined,
    plpPath: item.plpPath || undefined,
    ...(item.kind === "brand" ? { kind: "brand" as const } : {}),
    ...(item.taxonomyPath && item.taxonomyPath.length > 0
      ? { taxonomyPath: item.taxonomyPath }
      : {}),
  };
}

// ─── Pass A — propose the category/subcategory label tree ────────────────

const PASS_A_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          overlapping: { type: "boolean" },
          subcategories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
              required: ["id", "name"],
            },
          },
        },
        required: ["id", "name", "subcategories"],
      },
    },
    agentConclusion: { type: "string" },
  },
  required: ["categories", "agentConclusion"],
};

async function runTaxonomyPassA(params: {
  storeName: string;
  candidates: TaxonomyCandidate[];
  outputLanguage: string;
}): Promise<TaxonomyPassAOutput> {
  const { storeName, candidates, outputLanguage } = params;

  const candidateSummary = candidates.map((c) => ({
    name: c.name,
    taxonomyPath: c.taxonomyPath,
    kind: c.kind,
    productCount: c.productCount,
  }));

  const systemInstruction = `## Pass A of Stage 1 — propose the label tree only

You are naming the tree in this call — you are NOT placing any item id yet
(a separate Pass B call handles that afterwards, batched). Do not output any
item id here.

Required output language for every "name" and the "agentConclusion":
"${outputLanguage}" — the same language/script the store's own PLP names use.

Output strictly valid JSON matching this exact schema:
{
  "categories": [
    {
      "id": "url-safe-slug",
      "name": "Category Name",
      "overlapping": false,
      "subcategories": [ { "id": "url-safe-slug", "name": "Subcategory Name" } ]
    }
  ],
  "agentConclusion": "Plain-language summary of the tree you proposed, in ${outputLanguage}."
}`;

  const userPrompt = `Store: ${storeName}
Total candidate PLPs/brands: ${candidates.length}

${JSON.stringify(candidateSummary)}

Propose the full category/subcategory label tree now.`;

  const result = await runGeminiMarketResearch<TaxonomyPassAOutput>({
    stage: 1,
    systemInstruction,
    userPrompt,
    responseSchema: PASS_A_RESPONSE_SCHEMA,
  });

  return result.data;
}

// ─── Pass B — place a batch of ids onto the fixed tree ────────────────────

const PASS_B_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          itemId: { type: "string" },
          subcategoryId: { type: "string" },
          primary: { type: "boolean" },
        },
        required: ["itemId", "subcategoryId", "primary"],
      },
    },
    excluded: {
      type: "array",
      items: {
        type: "object",
        properties: {
          itemId: { type: "string" },
          name: { type: "string" },
          reason: {
            type: "string",
            enum: ["promotional", "attribute-only", "duplicate", "empty", "unresolved"],
          },
        },
        required: ["itemId", "name", "reason"],
      },
    },
  },
  required: ["assignments", "excluded"],
};

async function runTaxonomyPassBBatch(params: {
  storeName: string;
  outputLanguage: string;
  tree: TaxonomyPassAOutput;
  batch: TaxonomyCandidate[];
}): Promise<TaxonomyPassBOutput> {
  const { storeName, outputLanguage, tree, batch } = params;

  const flatSubcategories = tree.categories.flatMap((cat) =>
    cat.subcategories.map((sub) => ({
      subcategoryId: sub.id,
      subcategoryName: sub.name,
      categoryId: cat.id,
      categoryName: cat.name,
      overlapping: Boolean(cat.overlapping),
    }))
  );

  const systemInstruction = `## Pass B of Stage 1 — place these items onto the fixed tree

The category/subcategory tree below is already final for this store in this
run — never rename, merge, or invent a category/subcategory here; that
already happened in Pass A. Your only job is to place each candidate id
below onto exactly one (or, only for a genuine brand+product PLP or a
confirmed sibling duplicate, exactly two) of these existing subcategory ids,
or exclude it with a reason.

Fixed tree (subcategoryId -> category):
${JSON.stringify(flatSubcategories)}

For every item id in "Candidates to place" below, output exactly one of:
- One assignment {"itemId","subcategoryId","primary": true} — the normal case.
- Two assignments for the same itemId when it is a genuine brand+product PLP
  (e.g. a collection literally named "Nike Shoes"): primary: true under the
  product subcategory, primary: false under the brand subcategory.
- Two assignments for the same itemId when you know this item's inventory
  duplicates a sibling item's (e.g. "Apple laptops" duplicating "Laptops"):
  the narrower/duplicate one gets primary: false.
- An "excluded" entry with a reason ("promotional", "attribute-only",
  "duplicate", "empty") when the item is not real taxonomic content at all.

Every item id below must appear at least once, in "assignments" or
"excluded" — never omitted from both. Output language: "${outputLanguage}".

Output strictly valid JSON:
{ "assignments": [...], "excluded": [...] }`;

  const userPrompt = `Store: ${storeName}
Candidates to place (${batch.length} items):
${JSON.stringify(
    batch.map((c) => ({
      id: c.id,
      name: c.name,
      taxonomyPath: c.taxonomyPath,
      kind: c.kind,
      productCount: c.productCount,
    }))
  )}`;

  const result = await runGeminiMarketResearch<TaxonomyPassBOutput>({
    stage: 1,
    systemInstruction,
    userPrompt,
    responseSchema: PASS_B_RESPONSE_SCHEMA,
  });

  return result.data;
}

/** How many times one Pass B batch is retried (with just its still-missing
 *  ids, not the whole batch) before the remainder is routed to `unresolved`. */
const MAX_BATCH_ATTEMPTS = 2;

/**
 * Runs every Pass B batch and guarantees 100% id coverage: a batch that
 * comes back with missing ids is retried with only those ids; a batch that
 * throws (network/parse failure) is retried in full. Either way, whatever
 * is still missing after `MAX_BATCH_ATTEMPTS` is routed to `unresolved`
 * rather than silently dropped or absorbed into an unrelated category —
 * one failing/slow batch on a large catalog can never take down the whole
 * discovery.
 */
async function placeOneStage1Batch(params: {
  storeName: string;
  outputLanguage: string;
  tree: TaxonomyPassAOutput;
  batch: TaxonomyCandidate[];
  candidatesById: Map<string, TaxonomyCandidate>;
}): Promise<{ assignments: TaxonomyAssignment[]; excluded: ExcludedItem[] }> {
  let remaining = params.batch;
  let batchAssignments: TaxonomyAssignment[] = [];
  let batchExcluded: ExcludedItem[] = [];

  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS && remaining.length > 0; attempt++) {
    try {
      const output = await runTaxonomyPassBBatch({
        storeName: params.storeName,
        outputLanguage: params.outputLanguage,
        tree: params.tree,
        batch: remaining,
      });
      batchAssignments = [...batchAssignments, ...(output.assignments || [])];
      batchExcluded = [...batchExcluded, ...(output.excluded || [])];
      const { missingIds } = verifyAssignmentCoverage(
        remaining.map((c) => c.id),
        output.assignments || [],
        output.excluded || []
      );
      remaining = remaining.filter((c) => missingIds.includes(c.id));
    } catch (error) {
      console.error(
        `[runTaxonomyPassB] batch attempt ${attempt} failed (${remaining.length} items):`,
        error
      );
    }
  }

  const { missingIds } = verifyAssignmentCoverage(
    params.batch.map((c) => c.id),
    batchAssignments,
    batchExcluded
  );
  if (missingIds.length > 0) {
    batchExcluded.push(...routeMissingToUnresolved(missingIds, params.candidatesById));
  }
  return { assignments: batchAssignments, excluded: batchExcluded };
}

async function runTaxonomyPassBWithCoverage(params: {
  storeName: string;
  outputLanguage: string;
  tree: TaxonomyPassAOutput;
  candidates: TaxonomyCandidate[];
}): Promise<{ assignments: TaxonomyAssignment[]; excluded: ExcludedItem[] }> {
  const { storeName, outputLanguage, tree, candidates } = params;
  const candidatesById = indexCandidatesById(candidates);
  const batches = batchCandidates(candidates);
  const allAssignments: TaxonomyAssignment[] = [];
  const allExcluded: ExcludedItem[] = [];

  for (const batch of batches) {
    const placed = await placeOneStage1Batch({
      storeName,
      outputLanguage,
      tree,
      batch,
      candidatesById,
    });
    allAssignments.push(...placed.assignments);
    allExcluded.push(...placed.excluded);
  }

  return { assignments: allAssignments, excluded: allExcluded };
}

/** Pages placed per saved worker step. Small enough to finish and persist. */
export const STAGE1_PLACE_BATCH = 80;

export type Stage1Checkpoint = {
  storeName: string;
  outputLanguage: string;
  candidates: TaxonomyCandidate[];
  foldedItems: import("./taxonomy-build").RawCandidateInput[];
  foldedIntoEntries: Array<[string, string]>;
  tree: TaxonomyPassAOutput;
  assignments: TaxonomyAssignment[];
  excluded: ExcludedItem[];
  offset: number;
  agentConclusion: string;
};

export async function advanceStage1Discovery(input: {
  storeName: string;
  collections: StoreCollectionItem[];
  storeBrands?: StoreCollectionItem[];
  market?: string;
  checkpoint: Stage1Checkpoint | null;
}): Promise<{
  checkpoint: Stage1Checkpoint;
  done: boolean;
  result?: Stage1DiscoveryResult;
}> {
  const allItems = [...input.collections, ...(input.storeBrands ?? [])];
  if (!process.env.GEMINI_API_KEY?.trim() || allItems.length === 0) {
    const result = runHeuristicStage1Discovery(input);
    const empty: Stage1Checkpoint = {
      storeName: input.storeName,
      outputLanguage: "en",
      candidates: [],
      foldedItems: [],
      foldedIntoEntries: [],
      tree: { categories: [], agentConclusion: result.agentConclusion },
      assignments: [],
      excluded: [],
      offset: 0,
      agentConclusion: result.agentConclusion,
    };
    return { checkpoint: empty, done: true, result };
  }

  let checkpoint = input.checkpoint;
  if (!checkpoint) {
    const { candidates, foldedInto, foldedItems } = prepareStage1Catalog(allItems);
    const outputLanguage = detectOutputLanguage(candidates, input.market);
    const passA = await runTaxonomyPassA({
      storeName: input.storeName,
      candidates,
      outputLanguage,
    });
    if (!passA || !Array.isArray(passA.categories) || passA.categories.length === 0) {
      throw new Error("Pass A returned no categories");
    }
    checkpoint = {
      storeName: input.storeName,
      outputLanguage,
      candidates,
      foldedItems,
      foldedIntoEntries: [...foldedInto.entries()],
      tree: passA,
      assignments: [],
      excluded: [],
      offset: 0,
      agentConclusion: passA.agentConclusion || "",
    };
    return { checkpoint, done: false };
  }

  const batch = checkpoint.candidates.slice(
    checkpoint.offset,
    checkpoint.offset + STAGE1_PLACE_BATCH
  );
  if (batch.length > 0) {
    const placed = await placeOneStage1Batch({
      storeName: checkpoint.storeName,
      outputLanguage: checkpoint.outputLanguage,
      tree: checkpoint.tree,
      batch,
      candidatesById: indexCandidatesById(checkpoint.candidates),
    });
    checkpoint = {
      ...checkpoint,
      assignments: [...checkpoint.assignments, ...placed.assignments],
      excluded: [...checkpoint.excluded, ...placed.excluded],
      offset: checkpoint.offset + batch.length,
    };
  }

  if (checkpoint.offset < checkpoint.candidates.length) {
    return { checkpoint, done: false };
  }

  const candidatesById = indexCandidatesById(checkpoint.candidates);
  const finalAssignments = enforceWooParentPrimacy(
    normalizeAssignments(checkpoint.assignments),
    candidatesById
  );
  const foldedInto = new Map(checkpoint.foldedIntoEntries);
  const { categories, totalUniqueProducts } = computeSkuTotals({
    categories: checkpoint.tree.categories,
    assignments: finalAssignments,
    candidates: checkpoint.candidates,
    foldedItems: checkpoint.foldedItems,
    foldedInto,
  });
  const taxonomy: TaxonomyTree = {
    categories,
    assignments: finalAssignments,
    excluded: checkpoint.excluded,
    outputLanguage: checkpoint.outputLanguage,
    totalUniqueProducts,
  };
  const { structuredNiches, nichesReadings, excludedItems } =
    taxonomyToLegacyNiches(taxonomy, candidatesById);
  const result: Stage1DiscoveryResult = {
    niches: nichesReadings,
    structuredNiches,
    taxonomy,
    excludedItems,
    agentConclusion:
      checkpoint.agentConclusion ||
      `I organized ${checkpoint.storeName}'s catalog into ${categories.length} searchable categories covering ${totalUniqueProducts.toLocaleString()} unique products.`,
    beats: [],
    isAiGenerated: true,
  };
  return { checkpoint, done: true, result };
}

// ─── Legacy flattened view ────────────────────────────────────────────────

function taxonomyToLegacyNiches(
  taxonomy: TaxonomyTree,
  candidatesById: Map<string, TaxonomyCandidate>
): {
  structuredNiches: MockNiche[];
  nichesReadings: NicheReading[];
  excludedItems: MockExcludedItem[];
} {
  const structuredNiches: MockNiche[] = taxonomy.categories.map((cat) => {
    const subcategories: MockSubcategory[] = cat.subcategories.map((sub) => {
      const memberIds = taxonomy.assignments
        .filter((a) => a.primary && a.subcategoryId === sub.id)
        .map((a) => a.itemId);
      const collections: MockCollection[] = memberIds
        .map((id) => candidatesById.get(id))
        .filter((c): c is TaxonomyCandidate => Boolean(c))
        .map((c) => toMockCollection(c));
      return {
        id: sub.id,
        name: sub.name,
        productCount: sub.productCount,
        collections,
      };
    });

    // Always the full flattened list, even though `subcategories` above
    // carries the same PLPs nested — legacy consumers (seed generation, CSV
    // export, product counting) only ever look at `collections`.
    const collections: MockCollection[] = subcategories.flatMap(
      (s) => s.collections
    );

    return {
      id: cat.id,
      name: cat.name,
      productCount: cat.productCount,
      collections,
      subcategories,
      ...(cat.overlapping ? { overlapping: true } : {}),
    };
  });

  const nichesReadings: NicheReading[] = structuredNiches.map((sn) => ({
    id: sn.id,
    name: sn.name,
    summary: `Covers ${sn.collections.length} PLPs with ${sn.productCount.toLocaleString()} unique products.`,
  }));

  const excludedItems: MockExcludedItem[] = taxonomy.excluded.map((e) => ({
    id: e.itemId,
    name: e.name,
    reason: e.reason,
  }));

  return { structuredNiches, nichesReadings, excludedItems };
}

// ─── Orchestration ─────────────────────────────────────────────────────────

export async function runStage1NicheDiscovery(input: {
  storeName: string;
  collections: StoreCollectionItem[];
  /**
   * Every brand/vendor PLP on the store (Shopify `vendor` pages or the
   * WooCommerce brand taxonomy/attribute archives), each already shaped as a
   * full `StoreCollectionItem` with `kind: "brand"` and a real product
   * count. Merged straight into the working candidate list — a brand is
   * classified exactly like any other item, never treated as a separate
   * "signal-only" input.
   */
  storeBrands?: StoreCollectionItem[];
  /** Optional hint for language detection when the catalog's own PLP names
   *  don't carry a strong non-Latin script signal (see `detectOutputLanguage`). */
  market?: string;
}): Promise<Stage1DiscoveryResult> {
  const allItems: StoreCollectionItem[] = [
    ...input.collections,
    ...(input.storeBrands ?? []),
  ];

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || allItems.length === 0) {
    return runHeuristicStage1Discovery(input);
  }

  const { candidates, foldedInto, foldedItems } = prepareStage1Catalog(allItems);
  const outputLanguage = detectOutputLanguage(candidates, input.market);

  try {
    const passA = await runTaxonomyPassA({
      storeName: input.storeName,
      candidates,
      outputLanguage,
    });

    if (!passA || !Array.isArray(passA.categories) || passA.categories.length === 0) {
      throw new Error("Pass A returned no categories");
    }

    const { assignments: rawAssignments, excluded } = await runTaxonomyPassBWithCoverage({
      storeName: input.storeName,
      outputLanguage,
      tree: passA,
      candidates,
    });

    const candidatesById = indexCandidatesById(candidates);
    const normalized = normalizeAssignments(rawAssignments);
    const finalAssignments = enforceWooParentPrimacy(normalized, candidatesById);

    const { categories, totalUniqueProducts } = computeSkuTotals({
      categories: passA.categories,
      assignments: finalAssignments,
      candidates,
      foldedItems,
      foldedInto,
    });

    const taxonomy: TaxonomyTree = {
      categories,
      assignments: finalAssignments,
      excluded,
      outputLanguage,
      totalUniqueProducts,
    };

    const { structuredNiches, nichesReadings, excludedItems } =
      taxonomyToLegacyNiches(taxonomy, candidatesById);

    const totalItemsCount = allItems.length;
    const beats = [
      { at: 1200, text: `Connecting to ${input.storeName} storefront...` },
      {
        at: 2800,
        text: `Extracted ${totalItemsCount} active collections, categories and brand PLPs.`,
      },
      { at: 4500, text: `Classified into ${categories.length} searchable categories.` },
      { at: 6000, text: `Catalog grouped. Ready for scope selection.` },
    ];

    return {
      niches: nichesReadings,
      structuredNiches,
      taxonomy,
      excludedItems,
      agentConclusion:
        passA.agentConclusion ||
        `I organized ${input.storeName}'s catalog into ${categories.length} searchable categories covering ${totalUniqueProducts.toLocaleString()} unique products.`,
      beats,
      isAiGenerated: true,
    };
  } catch (error) {
    console.error("[runStage1NicheDiscovery] Taxonomy discovery failed:", error);
  }

  return runHeuristicStage1Discovery(input);
}

// ─── Heuristic fallback (no API key / Gemini failure) ─────────────────────
//
// A coarse, name-matching safety net — not held to the same search-language
// bar as the Gemini-backed path above. It only needs to keep the pipeline
// usable when the model is unavailable.

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
  const sortedByDepth = [...collectionList].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
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
    {
      at: 2500,
      text: `Indexed ${totalItemsCount} collections and brand PLPs across navigation structure.`,
    },
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

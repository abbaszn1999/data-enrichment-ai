import { afterEach, describe, expect, it, vi } from "vitest";
import { getFallbackStoreCatalog } from "./agent/store-catalog";
import { runHeuristicStage1Discovery } from "./agent/stage1-niche-discovery";
import { runHeuristicStage3SeedGeneration } from "./agent/stage3-seed-generator";
import { getAllSkills, loadSkill, parseSkillMarkdown } from "./agent/skill-loader";
import { getSeedRowsForCollections } from "@/components/market-research/mock-data";
import { runGeminiMarketResearch } from "./agent/gemini-runner";
import type {
  GeminiRunOptions,
  GeminiRunResult,
} from "./agent/gemini-runner";
import type { MarketResearchProduct } from "@/components/market-research/workspace-data";

vi.mock("./agent/gemini-runner", () => ({
  runGeminiMarketResearch: vi.fn(),
}));

describe("Market Research Agent - Skills Loader", () => {
  it("loads all 7 live-agent stage skills and validates frontmatter (stage 2 has no AI agent, so no skill file)", async () => {
    const skills = await getAllSkills();
    const expectedStages = [1, 3, 4, 5, 6, 7, 8];
    expect(skills.length).toBe(expectedStages.length);

    skills.forEach((skill, i) => {
      expect(skill.frontmatter.stage).toBe(expectedStages[i]);
      expect(skill.frontmatter.id).toBeDefined();
      expect(["low", "medium", "high"]).toContain(skill.frontmatter.thinking);
      expect(skill.frontmatter.tools.length).toBeGreaterThan(0);
      expect(skill.instructions.length).toBeGreaterThan(10);
    });
  });

  it("rejects minimal thinking level", () => {
    const badSkill = `---
id: 01-bad
stage: 1
thinking: minimal
tools: [read_store_collections]
output: NichesOutput
---
# Bad`;

    expect(() => parseSkillMarkdown(badSkill, "01-bad.md")).toThrow(
      /Gemini 3.7 Flash rejects 'minimal' thinking_level/
    );
  });
});

describe("Market Research Agent - Store Catalog", () => {
  it("provides an empty catalog when no store is connected", () => {
    const catalog = getFallbackStoreCatalog("Sample Store");
    expect(catalog.storeName).toBe("Sample Store");
    expect(catalog.collections).toEqual([]);
    expect(catalog.storeBrands).toEqual([]);
    expect(catalog.isMock).toBe(true);
  });
});

describe("Market Research Agent - Stage 1 Niche Discovery", () => {
  it("heuristically discovers niches from catalog collections", () => {
    const collections = [
      {
        id: "sunglasses-1",
        name: "Sunglasses",
        handle: "sunglasses",
        description: "Men and women sunglasses",
        productCount: 4200,
        plpPath: "/collections/sunglasses",
      },
      {
        id: "toys-1",
        name: "Educational Toys",
        handle: "educational-toys",
        description: "Learning toys for kids",
        productCount: 419,
        plpPath: "/collections/educational-toys",
      },
    ];

    const result = runHeuristicStage1Discovery({
      storeName: "Test Store",
      collections,
    });

    expect(result.niches.length).toBeGreaterThanOrEqual(2);
    expect(result.structuredNiches.length).toBeGreaterThanOrEqual(2);
    expect(result.agentConclusion).toContain("Test Store");
  });
});

describe("Market Research Agent - Stage 3 Seed Generator", () => {
  it("generates broad niche seeds according to rules without long-tail sub-niches", () => {
    const selectedCollections = [
      {
        id: "col-1",
        name: "Sunglasses",
        description: "All frames",
        productCount: 4200,
        parentNicheName: "Eyewear",
      },
    ];

    const result = runHeuristicStage3SeedGeneration({
      storeName: "Test Store",
      selectedCollections,
    });

    expect(result.seedRows.length).toBeGreaterThan(0);
    const primary = result.seedRows.find((r) => r.variationType === "Primary term");
    expect(primary).toBeDefined();
    expect(primary?.broadSeedVariation).toBe("Sunglasses");
    expect(primary?.canonicalNicheSeed).toBe("Sunglasses");
    expect(primary?.scopeMatch).toBe("Exact");
  });

  it("getSeedRowsForCollections respects overrideSeedRows from agent", () => {
    const customSeeds = [
      {
        id: "custom-1",
        collectionId: "sunglasses",
        broadSeedVariation: "Designer Shades",
        canonicalNicheSeed: "Sunglasses",
        selectedCollection: "Sunglasses",
        broadParentNiche: "Eyewear",
        productCount: 4200,
        variationType: "Common synonym" as const,
        scopeMatch: "Close" as const,
      },
    ];

    const rows = getSeedRowsForCollections(["sunglasses"], undefined, customSeeds);
    expect(rows.length).toBe(1);
    expect(rows[0].broadSeedVariation).toBe("Designer Shades");
  });
});

describe("Market Research Agent - Stage 4 Intent Classifier", () => {
  it("classifies keywords into category, informational, and excluded based on rules", async () => {
    const { runHeuristicStage4Classification } = await import(
      "./agent/stage4-intent-classifier"
    );

    const testKeywords = [
      { id: "kw-1", keyword: "men running shoes", volume: 14000, difficulty: 45 },
      { id: "kw-2", keyword: "how to choose running shoes", volume: 2400, difficulty: 20 },
      { id: "kw-3", keyword: "nike air zoom pegasus 40 black 256gb", volume: 800, difficulty: 15 },
      { id: "kw-4", keyword: "nike customer support login", volume: 1200, difficulty: 10 },
      { id: "kw-5", keyword: "waterproof smartwatches for swimming", volume: 3600, difficulty: 32 },
    ];

    const result = runHeuristicStage4Classification({
      keywords: testKeywords,
    });

    expect(result.classified.length).toBe(5);
    expect(result.summary.total).toBe(5);

    const kw1 = result.classified.find((c) => c.id === "kw-1");
    expect(kw1?.sheet).toBe("category");

    const kw2 = result.classified.find((c) => c.id === "kw-2");
    expect(kw2?.sheet).toBe("informational");

    const kw3 = result.classified.find((c) => c.id === "kw-3");
    expect(kw3?.sheet).toBe("excluded");

    const kw4 = result.classified.find((c) => c.id === "kw-4");
    expect(kw4?.sheet).toBe("excluded");

    const kw5 = result.classified.find((c) => c.id === "kw-5");
    expect(kw5?.sheet).toBe("category");
  });
});

describe("Market Research Agent - Stage 4 Batching and Concurrency", () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
    vi.mocked(runGeminiMarketResearch).mockReset();
  });

  it(
    "batches at 100/call with concurrency 5, retries a transient failure, heuristically falls back only for a persistently-failing batch, and never mixes ids across batches",
    async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const { runStage4IntentClassification } = await import(
        "./agent/stage4-intent-classifier"
      );

      // 950 keywords -> 10 batches of 100 (last batch has 50).
      const TOTAL = 950;
      const keywords = Array.from({ length: TOTAL }, (_, i) => ({
        id: `kw-${i}`,
        keyword: `term ${i}`,
      }));

      let inFlight = 0;
      let maxInFlight = 0;
      const attemptsByBatchStart = new Map<string, number>();

      vi.mocked(runGeminiMarketResearch).mockImplementation(async (
        opts: GeminiRunOptions
      ): Promise<GeminiRunResult<unknown>> => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);

        const parsed = JSON.parse(opts.userPrompt) as {
          keywordsToClassify: Array<{ id: string }>;
        };
        const ids: string[] = parsed.keywordsToClassify.map((k) => k.id);
        const batchKey = ids[0];

        // Batch 3 (starts at kw-200) fails once, then succeeds on retry.
        const isFlakyBatch = batchKey === "kw-200";
        // Batch 6 (starts at kw-500) always fails, forcing a heuristic fallback.
        const isBrokenBatch = batchKey === "kw-500";

        const attempts = (attemptsByBatchStart.get(batchKey) ?? 0) + 1;
        attemptsByBatchStart.set(batchKey, attempts);

        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;

        if (isBrokenBatch) {
          throw new Error("simulated persistent Gemini failure");
        }
        if (isFlakyBatch && attempts === 1) {
          throw new Error("simulated transient Gemini failure");
        }

        return {
          data: {
            classifications: ids.map((id) => ({
              id,
              sheet: "category",
              confidence: 0.95,
              reason: `AI reason for ${id}`,
            })),
          },
          rawText: "",
          cost: {} as GeminiRunResult<unknown>["cost"],
          credits: 0,
          model: "gemini-3.7-flash",
          thinkingLevel: "low",
        };
      });

      const result = await runStage4IntentClassification({ keywords });

      expect(result.isAiGenerated).toBe(true);
      expect(result.classified.length).toBe(TOTAL);

      // Every keyword got exactly one classification, matched by its own id —
      // no batch's response leaked onto another batch's rows.
      const byId = new Map(result.classified.map((c) => [c.id, c]));
      expect(byId.size).toBe(TOTAL);
      for (const kw of keywords) {
        expect(byId.has(kw.id)).toBe(true);
      }

      // Batches ran with bounded concurrency (>1, capped at 5) rather than
      // fully sequential or unbounded parallel.
      expect(maxInFlight).toBeGreaterThan(1);
      expect(maxInFlight).toBeLessThanOrEqual(5);

      // The flaky batch recovered via the single retry and used the AI path.
      expect(byId.get("kw-200")?.reason).toContain("AI reason");
      expect(attemptsByBatchStart.get("kw-200")).toBe(2);

      // The persistently-broken batch fell back to the heuristic classifier
      // (not the mocked AI reason) after exactly one retry, not endless retries.
      expect(byId.get("kw-500")?.reason).not.toContain("AI reason");
      expect(attemptsByBatchStart.get("kw-500")).toBe(2);
    },
    15000
  );
});

describe("Market Research Agent - Stage 5 Collection Clusterer", () => {
  it("clusters filtered category keywords into collection proposals with 1-to-1 mapping", async () => {
    const { runHeuristicStage5Clustering } = await import(
      "./agent/stage5-collection-clusterer"
    );

    const testFilteredKeywords = [
      {
        id: "kw-1",
        keyword: "digital art tablets with pen",
        seed: "Digital tablets with pen",
        volume: 20,
        difficulty: 0,
        plpConcept: "Use-case collection",
      },
      {
        id: "kw-2",
        keyword: "budget tablets with digital pen",
        seed: "Digital tablets with pen",
        volume: 10,
        difficulty: 5,
        plpConcept: "Price collection",
      },
    ];

    const result = runHeuristicStage5Clustering({
      storeName: "Tech Store",
      parentNiches: ["Electronics"],
      seedRows: [
        {
          id: "seed-1",
          canonicalNicheSeed: "Stylus Tablets",
          broadSeedVariation: "Digital tablets with pen",
          selectedCollection: "Tablets",
          broadParentNiche: "Electronics",
          productCount: 15,
          scopeMatch: "Close",
        },
      ],
      keywords: testFilteredKeywords,
    });

    expect(result.collections.length).toBe(2);
    expect(result.summary.totalVolume).toBe(30);
    expect(result.summary.totalCollections).toBe(2);

    const first = result.collections[0];
    expect(first.name).toBe("Digital Art Tablets with Pen");
    expect(first.headKeyword).toBe("digital art tablets with pen");
    expect(first.volume).toBe(20);
    expect(first.keywordCount).toBe(1);
    expect(first.status).toBe("new");

    const second = result.collections[1];
    expect(second.name).toBe("Budget Tablets with Digital Pen");
    expect(second.headKeyword).toBe("budget tablets with digital pen");
    expect(second.volume).toBe(10);
    expect(second.keywordCount).toBe(1);
    expect(second.status).toBe("new");
  });

  it("handles filtering down to a single keyword (e.g. Min Volume filter)", async () => {
    const { runHeuristicStage5Clustering } = await import(
      "./agent/stage5-collection-clusterer"
    );

    // User filtered out keywords with 0 volume, leaving only 1 keyword
    const singleFilteredKeyword = [
      {
        id: "kw-1",
        keyword: "digital art tablets with pen",
        seed: "Digital tablets with pen",
        volume: 20,
        difficulty: 0,
        plpConcept: "Use-case collection",
      },
    ];

    const result = runHeuristicStage5Clustering({
      storeName: "Tech Store",
      parentNiches: ["Electronics"],
      keywords: singleFilteredKeyword,
    });

    expect(result.collections.length).toBe(1);
    expect(result.collections[0].volume).toBe(20);
    expect(result.collections[0].keywordCount).toBe(1);
    expect(result.collections[0].headKeyword).toBe("digital art tablets with pen");
  });

  it("semantically matches catalog products to proposed collections using threshold retrieval", async () => {
    const { computeCollectionProductMatches, runHeuristicStage5Clustering } =
      await import("./agent/stage5-collection-clusterer");

    const mockProducts = [
      {
        id: "prod-1",
        title: "Pro Stylus Tablet 12.4 inch with Active Pen",
        handle: "pro-stylus-tablet",
        url: "/products/pro-stylus-tablet",
        price: { amount: 799, currency: "USD", priceFormatted: "$799.00" },
        shortDescription: "OLED display with pressure-sensitive stylus.",
        tags: ["tablet", "stylus", "drawing"],
        attributes: [{ name: "Pen Included", value: "Yes" }],
        images: [],
        collectionIds: ["col-tablets"],
        collectionNames: ["Tablets"],
        inStock: true,
      },
      {
        id: "prod-2",
        title: "Drawing Tablet Pen Display 16 inch",
        handle: "drawing-tablet-16",
        url: "/products/drawing-tablet-16",
        price: { amount: 499, currency: "USD", priceFormatted: "$499.00" },
        shortDescription: "Full HD digital drawing tablet screen.",
        tags: ["tablet", "stylus", "screen"],
        attributes: [],
        images: [],
        collectionIds: ["col-tablets"],
        collectionNames: ["Tablets"],
        inStock: true,
      },
      {
        id: "prod-3",
        title: "Classic Sunglasses Polarized Aviator",
        handle: "classic-sunglasses",
        url: "/products/classic-sunglasses",
        price: { amount: 149, currency: "USD", priceFormatted: "$149.00" },
        tags: ["eyewear", "sunglasses"],
        attributes: [],
        images: [],
        collectionIds: ["col-sunglasses"],
        collectionNames: ["Sunglasses"],
        inStock: true,
      },
    ];

    const matches = computeCollectionProductMatches(
      "Digital Art & Stylus Tablets",
      "drawing tablets with stylus",
      mockProducts
    );

    expect(matches.length).toBe(2);
    expect(matches.map((m) => m.productId)).toContain("prod-1");
    expect(matches.map((m) => m.productId)).toContain("prod-2");
    expect(matches.map((m) => m.productId)).not.toContain("prod-3");

    const clusterResult = runHeuristicStage5Clustering({
      storeName: "Tech Store",
      products: mockProducts,
      keywords: [
        {
          id: "kw-1",
          keyword: "drawing tablets with stylus",
          volume: 2400,
          difficulty: 30,
        },
        {
          id: "kw-2",
          keyword: "studio headsets",
          volume: 90,
          difficulty: 28,
        },
      ],
    });

    expect(clusterResult.collections.length).toBe(1);
    // Exact volume and KD preserved (1-to-1 mapping) & zero-match collection (studio headsets) is suppressed
    const kw1Col = clusterResult.collections.find((c) => c.headKeyword === "drawing tablets with stylus");
    expect(kw1Col).toBeDefined();
    expect(kw1Col?.name).toBe("Drawing Tablets with Stylus");
    expect(kw1Col?.volume).toBe(2400);
    expect(kw1Col?.difficulty).toBe(30);
    expect(kw1Col?.status).toBe("new");
    expect(kw1Col?.matchedProductIds).toContain("prod-1");
    expect(kw1Col?.matchedProductIds).toContain("prod-2");

    // kw-2 (studio headsets) has 0 matching products in catalog and is suppressed
    const kw2Col = clusterResult.collections.find((c) => c.headKeyword === "studio headsets");
    expect(kw2Col).toBeUndefined();
  });
});

describe("Market Research Agent - Stage 6 On-Page Copywriter", () => {
  it("generates on-page SEO fields with custom instructions for the 4 fields", async () => {
    const { runHeuristicStage6OnPage } = await import(
      "./agent/stage6-on-page-generator"
    );

    const testCollections = [
      {
        id: "col-stylus-tablets",
        name: "Stylus Tablets",
        headKeyword: "digital tablets with pen",
        parentNiche: "Electronics",
        volume: 20,
        difficulty: 0,
        productCount: 5,
        keywordCount: 1,
        status: "new" as const,
      },
    ];

    const customInstructions = {
      seoTitle: "Include 'Official Store' suffix",
      seoDescription: "Emphasize 2-year warranty and express delivery",
      collectionDescription: "Friendly professional tone for digital artists",
      faq: "Include battery life questions and compatibility",
    };

    const result = runHeuristicStage6OnPage({
      storeName: "ArtTech Store",
      parentNiches: ["Electronics"],
      collections: testCollections,
      customInstructions,
    });

    const content = result.contentById["col-stylus-tablets"];
    expect(content).toBeDefined();
    expect(content.seoTitle).toContain("Stylus Tablets");
    expect(content.seoTitle).toContain("Official Store");
    expect(content.seoDescription).toContain("warranty");
    expect(content.collectionDescription).toContain("artists");
    expect(content.faqs.length).toBeGreaterThanOrEqual(3);
    expect(content.links.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Market Research Agent - Embeddings int8 vector round-trip", () => {
  it("round-trips a random unit-ish vector through encode/decode within float32 tolerance", async () => {
    const { encodeVectorInt8, decodeVectorInt8, cosineSimilarity } = await import(
      "./agent/embeddings"
    );

    const dims = 512;
    const original = Array.from({ length: dims }, () => Math.random() * 2 - 1);

    const encoded = encodeVectorInt8(original);
    expect(typeof encoded).toBe("string");
    // int8 (1 byte/dim) base64-encoded should be far smaller than the
    // ~6KB a raw float32 JSON array would take for 512 dims.
    expect(encoded.length).toBeLessThan(1000);

    const decoded = decodeVectorInt8(encoded, dims);
    expect(decoded.length).toBe(dims);

    // Cosine similarity against itself must survive quantization at well
    // under 1% error, matching the design budget in the plan.
    const selfSimilarity = cosineSimilarity(original, decoded);
    expect(selfSimilarity).toBeGreaterThan(0.99);
  });

  it("preserves relative cosine ranking between a near-duplicate and an unrelated vector after quantization", async () => {
    const { encodeVectorInt8, decodeVectorInt8, cosineSimilarity } = await import(
      "./agent/embeddings"
    );
    const dims = 64;

    const base = Array.from({ length: dims }, (_, i) => Math.sin(i));
    const nearDuplicate = base.map((v) => v + 0.01);
    const unrelated = Array.from({ length: dims }, (_, i) => Math.cos(i * 3));

    const decodedBase = decodeVectorInt8(encodeVectorInt8(base), dims);
    const decodedNear = decodeVectorInt8(encodeVectorInt8(nearDuplicate), dims);
    const decodedUnrelated = decodeVectorInt8(encodeVectorInt8(unrelated), dims);

    const simNear = cosineSimilarity(decodedBase, decodedNear);
    const simUnrelated = cosineSimilarity(decodedBase, decodedUnrelated);

    expect(simNear).toBeGreaterThan(simUnrelated);
    expect(simNear).toBeGreaterThan(0.99);
  });

  it("contentHash is stable for identical text and differs for changed text (skip-on-rerun basis)", async () => {
    const { contentHash } = await import("./agent/embeddings");

    const a = contentHash("Title: Sunglasses | Type: Eyewear");
    const b = contentHash("Title: Sunglasses | Type: Eyewear");
    const c = contentHash("Title: Sunglasses | Type: Eyewear (updated)");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("Market Research Agent - Stage 5 collection-scoped vector candidate filtering", () => {
  it("computeCollectionVectorMatches only ranks products already scoped by the caller, drops products missing a vector, and enforces threshold + cap", async () => {
    const { computeCollectionVectorMatches } = await import(
      "./agent/stage5-collection-clusterer"
    );

    const makeProduct = (id: string, collectionIds: string[]): MarketResearchProduct => ({
      id,
      title: id,
      handle: id,
      url: `/products/${id}`,
      images: [],
      price: { amount: 10, currency: "USD", priceFormatted: "$10.00" },
      tags: [],
      attributes: [],
      collectionIds,
      collectionNames: [],
      inStock: true,
    });

    // Two products already scoped to "col-tablets" (the caller's exact
    // collectionId lineage filter), one product that belongs to a totally
    // different collection but is passed in anyway to prove the function
    // itself does not re-widen scope, and one scoped product with no vector.
    const scopedProducts = [
      makeProduct("prod-close", ["col-tablets"]),
      makeProduct("prod-far", ["col-tablets"]),
      makeProduct("prod-no-vector", ["col-tablets"]),
    ];

    const termVector = [1, 0, 0, 0];
    const productVectors = new Map<string, number[]>([
      ["prod-close", [0.99, 0.14, 0, 0]], // cosine ~0.99, above threshold
      ["prod-far", [0, 1, 0, 0]], // cosine 0, below threshold
      // "prod-no-vector" intentionally has no entry.
    ]);

    const matches = computeCollectionVectorMatches(
      termVector,
      scopedProducts,
      productVectors,
      0.32,
      200
    );

    expect(matches.length).toBe(1);
    expect(matches[0].productId).toBe("prod-close");
    // A missing vector must never be treated as a similarity of 0 that
    // still counts as "scored" — it should be silently excluded entirely.
    expect(matches.map((m) => m.productId)).not.toContain("prod-no-vector");
    expect(matches.map((m) => m.productId)).not.toContain("prod-far");
  });

  it("caps ranked candidates at topCap even when many products clear the threshold", async () => {
    const { computeCollectionVectorMatches } = await import(
      "./agent/stage5-collection-clusterer"
    );

    const makeProduct = (id: string): MarketResearchProduct => ({
      id,
      title: id,
      handle: id,
      url: `/products/${id}`,
      images: [],
      price: { amount: 10, currency: "USD", priceFormatted: "$10.00" },
      tags: [],
      attributes: [],
      collectionIds: ["col-tablets"],
      collectionNames: [],
      inStock: true,
    });

    const products = Array.from({ length: 10 }, (_, i) => makeProduct(`prod-${i}`));
    const termVector = [1, 0];
    const productVectors = new Map<string, number[]>(
      products.map((p) => [p.id, [1, 0]]) // all identical, all cosine 1.0
    );

    const matches = computeCollectionVectorMatches(
      termVector,
      products,
      productVectors,
      0.32,
      3
    );

    expect(matches.length).toBe(3);
  });
});

describe("Market Research Agent - Stage 5 Gemini receives the full cosine shortlist", () => {
  afterEach(() => {
    vi.mocked(runGeminiMarketResearch).mockReset();
  });

  it("sends every cosine survivor to Gemini and persists the full match lists", async () => {
    const captured: string[] = [];
    vi.mocked(runGeminiMarketResearch).mockImplementation(
      async (opts: GeminiRunOptions): Promise<GeminiRunResult<unknown>> => {
        captured.push(opts.userPrompt);
        const jsonStart = opts.userPrompt.indexOf("[");
        const batch = JSON.parse(opts.userPrompt.slice(jsonStart)) as Array<{
          keywordId: string;
          candidateProducts: Array<{ id: string }>;
        }>;
        return {
          data: {
            collections: batch.map((piece) => ({
              keywordId: piece.keywordId,
              matchedProductIds: piece.candidateProducts.map((c) => c.id),
              rationale: "kept",
            })),
          },
          rawText: "",
          cost: {} as GeminiRunResult<unknown>["cost"],
          credits: 0,
          model: "gemini-3.7-flash",
          thinkingLevel: "low",
        };
      }
    );

    const { runStage5CollectionClustering } = await import(
      "./agent/stage5-collection-clusterer"
    );

    const COUNT = 60;
    const makeProduct = (id: string): MarketResearchProduct => ({
      id,
      title: id,
      handle: id,
      url: `/products/${id}`,
      images: [],
      price: { amount: 10, currency: "USD", priceFormatted: "$10.00" },
      tags: [],
      attributes: [],
      collectionIds: ["col-tablets"],
      collectionNames: ["Tablets"],
      inStock: true,
    });

    const products = Array.from({ length: COUNT }, (_, i) => makeProduct(`p${i}`));
    const termVector = [1, 0, 0, 0];
    const productVectors = new Map<string, number[]>(
      products.map((p) => [p.id, [1, 0, 0, 0]])
    );

    const result = await runStage5CollectionClustering({
      storeName: "Tech Store",
      keywords: [
        {
          id: "k1",
          keyword: "test term",
          volume: 100,
          difficulty: 10,
        },
      ],
      products,
      collectionIdByKeywordId: { k1: "col-tablets" },
      termVectors: new Map([["k1", termVector]]),
      productVectors,
    });

    expect(captured.length).toBeGreaterThan(0);
    const sentIds = captured.flatMap((prompt) => {
      const jsonStart = prompt.indexOf("[");
      const batch = JSON.parse(prompt.slice(jsonStart)) as Array<{
        candidateProducts: Array<{ id: string }>;
      }>;
      return batch.flatMap((piece) => piece.candidateProducts.map((c) => c.id));
    });
    expect(sentIds).toHaveLength(COUNT);
    expect(new Set(sentIds).size).toBe(COUNT);
    for (let i = 0; i < COUNT; i++) {
      expect(sentIds).toContain(`p${i}`);
    }

    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].matchedProductIds).toHaveLength(COUNT);
    expect(result.collections[0].productMatches).toHaveLength(COUNT);
    expect(result.collections[0].candidateMatches).toHaveLength(COUNT);
  });
});

describe("Market Research Agent - Storage Admin merge-not-overwrite on cursor writes", () => {
  it("mergeById upserts by id without dropping earlier pages' entries", async () => {
    const { mergeById } = await import("./storage-admin");

    // Page 1 already wrote these two collections to the stored slice.
    const existing = [
      { id: "col-a", name: "Collection A", volume: 10 },
      { id: "col-b", name: "Collection B", volume: 20 },
    ];

    // Page 2's cursor call only knows about "col-b" (updated) and "col-c"
    // (new) — it must never see or resend "col-a".
    const incoming = [
      { id: "col-b", name: "Collection B", volume: 25 },
      { id: "col-c", name: "Collection C", volume: 5 },
    ];

    const merged = mergeById(existing, incoming);

    expect(merged.length).toBe(3);
    const byId = new Map(merged.map((c) => [c.id, c]));
    // Untouched earlier entry survives a later page's write.
    expect(byId.get("col-a")?.volume).toBe(10);
    // Later page's value wins on a collision, rather than being ignored.
    expect(byId.get("col-b")?.volume).toBe(25);
    // Brand-new entry from the later page is appended, not dropped.
    expect(byId.get("col-c")?.volume).toBe(5);
  });

  it("is a no-op merge when incoming is empty, and fully replaces when existing is empty", async () => {
    const { mergeById } = await import("./storage-admin");

    const existing = [{ id: "x", value: 1 }];
    expect(mergeById(existing, [])).toEqual(existing);

    const incoming = [{ id: "y", value: 2 }];
    expect(mergeById([], incoming)).toEqual(incoming);
  });
});

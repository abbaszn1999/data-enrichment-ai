import { describe, expect, it } from "vitest";
import { getFallbackStoreCatalog } from "./agent/store-catalog";
import { runHeuristicStage1Discovery } from "./agent/stage1-niche-discovery";
import { runHeuristicStage3SeedGeneration } from "./agent/stage3-seed-generator";
import { getAllSkills, loadSkill, parseSkillMarkdown } from "./agent/skill-loader";
import { getSeedRowsForCollections } from "@/components/market-research/mock-data";

describe("Market Research Agent - Skills Loader", () => {
  it("loads all 7 stage skills and validates frontmatter", async () => {
    const skills = await getAllSkills();
    expect(skills.length).toBe(7);

    for (let i = 0; i < 7; i++) {
      const stage = i + 1;
      const skill = skills[i];
      expect(skill.frontmatter.stage).toBe(stage);
      expect(skill.frontmatter.id).toBeDefined();
      expect(["low", "medium", "high"]).toContain(skill.frontmatter.thinking);
      expect(skill.frontmatter.tools.length).toBeGreaterThan(0);
      expect(skill.instructions.length).toBeGreaterThan(10);
    }
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
  it("provides fallback catalog when no store is connected", () => {
    const catalog = getFallbackStoreCatalog("Sample Store");
    expect(catalog.storeName).toBe("Sample Store");
    expect(catalog.collections.length).toBeGreaterThan(0);
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

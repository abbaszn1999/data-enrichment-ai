import { beforeEach, describe, expect, it } from "vitest";
import {
  buildArticleLinkTargets,
  buildInternalLinkGraph,
  classifyRelation,
  stripCollectionPrefix,
} from "./internal-links";
import type { ProposedCollection } from "@/components/market-research/workspace-data";
import type { StoreCollectionItem } from "./store-catalog";

function proposed(
  partial: Partial<ProposedCollection> & { id: string; name: string }
): ProposedCollection {
  return {
    headKeyword: partial.name.toLowerCase(),
    parentNiche: "Electronics",
    volume: 100,
    difficulty: 10,
    productCount: 4,
    keywordCount: 1,
    status: "new",
    ...partial,
  };
}

function storeCollection(
  partial: Partial<StoreCollectionItem> & { id: string; name: string; handle: string }
): StoreCollectionItem {
  return {
    description: "",
    productCount: 4,
    plpPath: `/collections/${partial.handle}`,
    published: true,
    ...partial,
  };
}

describe("stripCollectionPrefix", () => {
  it("removes the store naming prefix in its common separator forms", () => {
    expect(stripCollectionPrefix("AI - Apple Chargers", "AI")).toBe("Apple Chargers");
    expect(stripCollectionPrefix("AI Apple Chargers", "AI")).toBe("Apple Chargers");
    expect(stripCollectionPrefix("AI: Apple Chargers", "AI")).toBe("Apple Chargers");
    expect(stripCollectionPrefix("Apple Chargers", "AI")).toBe("Apple Chargers");
  });
});

describe("classifyRelation", () => {
  const set = (...tokens: string[]) => new Set(tokens);

  it("treats identical token sets as duplicates", () => {
    expect(classifyRelation(set("apple", "chargers"), set("apple", "chargers"))).toBe(
      "duplicate"
    );
  });

  it("identifies a broader page as the parent", () => {
    expect(
      classifyRelation(set("apple", "ipad", "chargers"), set("apple", "chargers"))
    ).toBe("parent");
  });

  it("identifies a narrower page as the child", () => {
    expect(
      classifyRelation(set("apple", "chargers"), set("apple", "ipad", "chargers"))
    ).toBe("child");
  });

  it("identifies same-level variations as siblings", () => {
    expect(
      classifyRelation(set("apple", "ipad", "chargers"), set("samsung", "ipad", "chargers"))
    ).toBe("sibling");
  });

  it("rejects pages with no shared tokens", () => {
    expect(classifyRelation(set("apple", "chargers"), set("garden", "hoses"))).toBe(
      "unrelated"
    );
  });
});

describe("buildInternalLinkGraph", () => {
  beforeEach(() => {
    // Keep the suite offline: no embeddings request, no Gemini call.
    process.env.OPENAI_API_KEY = "";
  });

  const storeCollections: StoreCollectionItem[] = [
    storeCollection({
      id: "gid://shopify/Collection/1",
      name: "AI - Apple Chargers and Cables",
      handle: "ai-apple-chargers-and-cables",
    }),
    storeCollection({
      id: "gid://shopify/Collection/2",
      name: "AI - Apple Ipad Chargers and Cables",
      handle: "ai-apple-ipad-chargers-and-cables",
    }),
    storeCollection({
      id: "gid://shopify/Collection/3",
      name: "AI - Cables and Chargers",
      handle: "ai-cables-and-chargers",
      productCount: 3,
    }),
    storeCollection({
      id: "gid://shopify/Collection/4",
      name: "AI - Storage for Chargers and Cables",
      handle: "ai-storage-for-chargers-and-cables",
    }),
  ];

  const proposedCollections: ProposedCollection[] = [
    proposed({ id: "col-apple-chargers-and-cables-1", name: "Apple Chargers and Cables" }),
    proposed({
      id: "col-apple-ipad-chargers-and-cables-3",
      name: "Apple Ipad Chargers and Cables",
    }),
    proposed({ id: "col-cables-and-chargers-4", name: "Cables and Chargers" }),
    proposed({
      id: "col-storage-for-chargers-and-cables-2",
      name: "Storage for Chargers and Cables",
    }),
  ];

  it("never links a collection to itself across the naming prefix", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections,
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    const links = graph["col-apple-chargers-and-cables-1"];
    expect(links.length).toBeGreaterThan(0);
    expect(
      links.some((link) => link.href === "/collections/ai-apple-chargers-and-cables")
    ).toBe(false);
  });

  it("only emits hrefs that exist in the store registry", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections,
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    const validHrefs = new Set(storeCollections.map((c) => c.plpPath));
    for (const links of Object.values(graph)) {
      for (const link of links) {
        expect(validHrefs.has(link.href)).toBe(true);
      }
    }
  });

  it("never leaks the internal collection id suffix into a url", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections,
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    for (const links of Object.values(graph)) {
      for (const link of links) {
        expect(link.href).not.toMatch(/-\d+$/);
      }
    }
  });

  it("links a narrow page up to its broader parent", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections,
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    const links = graph["col-apple-ipad-chargers-and-cables-3"];
    expect(
      links.some((link) => link.href === "/collections/ai-apple-chargers-and-cables")
    ).toBe(true);
  });

  it("excludes unpublished collections because their urls 404", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections: storeCollections.map((c) =>
        c.handle === "ai-cables-and-chargers" ? { ...c, published: false } : c
      ),
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    for (const links of Object.values(graph)) {
      expect(
        links.some((link) => link.href === "/collections/ai-cables-and-chargers")
      ).toBe(false);
    }
  });

  it("excludes empty collections rather than linking to a thin page", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections: storeCollections.map((c) =>
        c.handle === "ai-storage-for-chargers-and-cables"
          ? { ...c, productCount: 0 }
          : c
      ),
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    for (const links of Object.values(graph)) {
      expect(
        links.some(
          (link) => link.href === "/collections/ai-storage-for-chargers-and-cables"
        )
      ).toBe(false);
    }
  });

  it("does not point at collections that have not been pushed to the store yet", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections: [],
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    // Nothing is verifiable, so every page falls back to guaranteed routes.
    for (const links of Object.values(graph)) {
      for (const link of links) {
        expect(["/collections", "/collections/all"]).toContain(link.href);
      }
    }
  });

  it("gives every live collection at least one inbound link", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections,
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    const inbound = new Map<string, number>();
    for (const links of Object.values(graph)) {
      for (const link of links) {
        inbound.set(link.href, (inbound.get(link.href) ?? 0) + 1);
      }
    }

    for (const collection of storeCollections) {
      expect(inbound.get(collection.plpPath) ?? 0).toBeGreaterThan(0);
    }
  });

  it("does not repeat the same anchor text within one link block", async () => {
    const graph = await buildInternalLinkGraph({
      proposed: proposedCollections,
      storeCollections,
      collectionPrefix: "AI",
      provider: "shopify",
      disableAi: true,
    });

    for (const links of Object.values(graph)) {
      const anchors = links.map((link) => link.label.toLowerCase());
      expect(new Set(anchors).size).toBe(anchors.length);
    }
  });
});

describe("buildArticleLinkTargets", () => {
  beforeEach(() => {
    // Keep the suite offline: no embeddings request, purely lexical scoring.
    process.env.OPENAI_API_KEY = "";
  });

  // Every collection's title is "Widgets" plus a distinct stop word (filtered
  // out by tokenize, so every node's token set is identically ["widgets"]),
  // giving all six a perfect 1.0 lexical match against an article that is
  // just "widgets" — the only thing that can trim the list is the cap itself.
  const widgetsSuffixes = ["And", "For", "With", "All", "Our", "From"];
  function widgetVariants() {
    return widgetsSuffixes.map((suffix, i) =>
      proposed({
        id: `widgets-${i}`,
        name: `Widgets ${suffix}`,
        volume: 100,
        difficulty: 20,
        productCount: 5,
        storeHandle: `widgets-variant-${i}`,
      })
    );
  }

  it("defaults to 5 links per article, not 4", async () => {
    const { linksByArticle } = await buildArticleLinkTargets({
      articles: [{ id: "a1", title: "widgets", keyword: "widgets" }],
      proposed: widgetVariants(),
    });

    expect(linksByArticle.a1.length).toBe(5);
  });

  it("respects an explicit linksPerArticle override", async () => {
    const { linksByArticle } = await buildArticleLinkTargets({
      articles: [{ id: "a1", title: "widgets", keyword: "widgets" }],
      proposed: widgetVariants(),
      linksPerArticle: 3,
    });

    expect(linksByArticle.a1.length).toBe(3);
  });

  it("reports the proposed collection id behind each chosen link, including when it matched an existing store node", async () => {
    const golden = proposed({
      id: "golden-collection-id",
      name: "AI - Golden Widgets",
      volume: 100000,
      difficulty: 12,
      productCount: 40,
      storeHandle: "ai-golden-widgets",
    });

    const { linksByArticle, collectionIdsByArticle } = await buildArticleLinkTargets({
      articles: [
        { id: "a1", title: "Guide to Golden Widgets", keyword: "golden widgets" },
      ],
      proposed: [golden],
      storeCollections: [
        storeCollection({
          id: "gid://shopify/Collection/99",
          name: "AI - Golden Widgets",
          handle: "ai-golden-widgets",
          productCount: 40,
        }),
      ],
      collectionPrefix: "AI",
      linksPerArticle: 1,
    });

    expect(linksByArticle.a1).toHaveLength(1);
    expect(collectionIdsByArticle.a1).toEqual(["golden-collection-id"]);
  });

  it("reuses a golden (high-volume, low-difficulty) collection across every relevant article with no inbound cap", async () => {
    const golden = proposed({
      id: "golden",
      name: "Golden Widgets",
      volume: 100000,
      difficulty: 12,
      productCount: 40,
      storeHandle: "golden-widgets",
    });
    const silver = proposed({
      id: "silver",
      name: "Silver Widgets",
      volume: 100,
      difficulty: 50,
      productCount: 40,
      storeHandle: "silver-widgets",
    });
    // Unrelated filler nodes inflate the total linkable pool so a proportional,
    // fair-share style inbound cap (if one existed) would bind well below 10.
    const fillerNames = [
      "Umbrellas",
      "Kettles",
      "Ladders",
      "Lanterns",
      "Blenders",
      "Toolboxes",
      "Backpacks",
      "Mirrors",
      "Curtains",
      "Cushions",
      "Planters",
      "Notebooks",
      "Sunglasses",
      "Thermostats",
      "Doormats",
    ];
    const filler = fillerNames.map((word, i) =>
      proposed({
        id: `filler-${i}`,
        name: `Filler ${word}`,
        volume: 10,
        difficulty: 80,
        productCount: 5,
        storeHandle: `filler-${word.toLowerCase()}`,
      })
    );

    const articles = Array.from({ length: 10 }, (_, i) => ({
      id: `article-${i}`,
      title: "Guide to Golden Widgets",
      keyword: "golden widgets",
    }));

    const { linksByArticle } = await buildArticleLinkTargets({
      articles,
      proposed: [golden, silver, ...filler],
      linksPerArticle: 1,
    });

    for (const article of articles) {
      expect(linksByArticle[article.id]).toHaveLength(1);
      expect(linksByArticle[article.id][0].collectionName).toBe("Golden Widgets");
    }
  });

  it("lets a much better opportunity score outrank a merely-more-literal relevance match", async () => {
    // Both candidates share almost every descriptor with the article (a
    // realistic "close paraphrase" gap, not an exact-match-vs-unrelated one):
    // "Precise Match" has all twelve plus its own extra word; "Broad Match"
    // is missing just one of the twelve, so it is slightly less relevant.
    // Precise's opportunity is terrible (tiny volume, sky-high difficulty)
    // while Broad's is excellent (huge volume, easy difficulty) — the
    // authority weighting should let Broad win despite the relevance gap.
    const descriptors =
      "black steel folding wireless bluetooth rechargeable portable waterproof heavy compact durable premium";

    const precise = proposed({
      id: "precise",
      name: `${descriptors} sigma`,
      volume: 5,
      difficulty: 5000,
      productCount: 10,
      storeHandle: "precise-match",
    });
    const broad = proposed({
      id: "broad",
      // Missing "premium" — 11 of the 12 shared descriptors, plus its own
      // extra word instead of "sigma".
      name: "black steel folding wireless bluetooth rechargeable portable waterproof heavy compact durable omega",
      volume: 200000,
      difficulty: 12,
      productCount: 10,
      storeHandle: "broad-match",
    });

    const { linksByArticle } = await buildArticleLinkTargets({
      articles: [{ id: "a1", title: descriptors, keyword: descriptors }],
      proposed: [precise, broad],
      linksPerArticle: 1,
    });

    expect(linksByArticle.a1).toHaveLength(1);
    expect(linksByArticle.a1[0].collectionName.toLowerCase()).toBe(
      "black steel folding wireless bluetooth rechargeable portable waterproof heavy compact durable omega"
    );
  });
});

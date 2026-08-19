import { beforeEach, describe, expect, it } from "vitest";
import {
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

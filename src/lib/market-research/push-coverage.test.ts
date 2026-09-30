import { describe, expect, it } from "vitest";
import { articleLinksPushedCollection, isPushedCollection } from "./push-coverage";
import type { ProposedCollection } from "@/components/market-research/workspace-data";

const col = (patch: Partial<ProposedCollection>) => ({ id: "c", name: "C", ...patch }) as ProposedCollection;

describe("push coverage", () => {
  it("treats a collection as paid only once the push saved a store id", () => {
    expect(isPushedCollection(col({}))).toBe(false);
    expect(isPushedCollection(col({ storeHandle: "ai-rugs" }))).toBe(true);
    expect(isPushedCollection(col({ storeCollectionId: "gid://shopify/Collection/1" }))).toBe(true);
  });

  it("covers an article that links to a pushed collection", () => {
    const collections = [col({ id: "a", storeHandle: "ai-wool-rugs" }), col({ id: "b" })];
    const link = (url: string) => ({ linksOut: [{ anchor: "x", url, collectionName: "x" }] });
    expect(articleLinksPushedCollection(link("https://shop.com/collections/ai-wool-rugs"), collections)).toBe(true);
    expect(articleLinksPushedCollection(link("https://shop.com/product-category/home/ai-wool-rugs/"), collections)).toBe(true);
    expect(articleLinksPushedCollection(link("https://shop.com/collections/ai-wool-rugs-extra"), collections)).toBe(false);
    expect(articleLinksPushedCollection(link("https://shop.com/collections/merchant-own"), collections)).toBe(false);
    expect(articleLinksPushedCollection({ linksOut: [] }, collections)).toBe(false);
    expect(articleLinksPushedCollection(null, collections)).toBe(false);
  });
});

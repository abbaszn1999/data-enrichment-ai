import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationRecord } from "@/lib/sync/core/types";

const shopifyGraphQL = vi.fn();

vi.mock("./graphql-client", () => ({
  shopifyGraphQL: (args: unknown) => shopifyGraphQL(args),
}));

const { detectNewCollectionProducts, removeProductsFromCollection } = await import(
  "./collections"
);

const integration: IntegrationRecord = {
  provider: "shopify",
  integration_name: "Test Store",
  base_url: "https://test.myshopify.com",
  config: { access_token: "shpat_test" },
};

type Node = {
  id: string;
  title: string;
  createdAt: string;
  productType?: string;
  featuredImage?: { url: string } | null;
  onlineStoreUrl?: string | null;
};

function page(nodes: Node[], hasNextPage = false, endCursor: string | null = null) {
  return {
    data: {
      collection: {
        products: {
          edges: nodes.map((node, index) => ({ cursor: `c${index}`, node })),
          pageInfo: { hasNextPage, endCursor },
        },
      },
    },
    errors: [],
  };
}

function node(id: string, createdAt: string, extra: Partial<Node> = {}): Node {
  return { id, title: `Product ${id}`, createdAt, ...extra };
}

beforeEach(() => {
  shopifyGraphQL.mockReset();
});

describe("detectNewCollectionProducts", () => {
  it("returns nothing without calling Shopify when there is no watermark yet", async () => {
    const result = await detectNewCollectionProducts({
      integration,
      collectionId: "gid://shopify/Collection/1",
      since: null,
    });

    // A brand-new rule owns the future only; walking the back catalogue here
    // would classify the whole store on the first tick.
    expect(result.products).toEqual([]);
    expect(result.newestCreatedAt).toBeNull();
    expect(shopifyGraphQL).not.toHaveBeenCalled();
  });

  it("stops at the first product older than the watermark", async () => {
    shopifyGraphQL.mockResolvedValue(
      page(
        [
          node("gid://p/3", "2026-08-10T12:00:00Z"),
          node("gid://p/2", "2026-08-09T12:00:00Z"),
          node("gid://p/1", "2026-08-01T12:00:00Z"),
        ],
        true,
        "cursor-1"
      )
    );

    const result = await detectNewCollectionProducts({
      integration,
      collectionId: "gid://shopify/Collection/1",
      since: "2026-08-05T00:00:00Z",
    });

    expect(result.products.map((p) => p.id)).toEqual(["gid://p/3", "gid://p/2"]);
    // Sorted newest first, so one page was enough even though more exist.
    expect(shopifyGraphQL).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBeUndefined();
  });

  it("reports the newest creation time so the watermark can advance", async () => {
    shopifyGraphQL.mockResolvedValue(
      page([
        node("gid://p/3", "2026-08-10T12:00:00Z"),
        node("gid://p/2", "2026-08-01T12:00:00Z"),
      ])
    );

    const result = await detectNewCollectionProducts({
      integration,
      collectionId: "gid://shopify/Collection/1",
      since: "2026-08-05T00:00:00Z",
    });

    expect(result.newestCreatedAt).toBe("2026-08-10T12:00:00Z");
  });

  it("treats a product created exactly at the watermark as already seen", async () => {
    shopifyGraphQL.mockResolvedValue(
      page([node("gid://p/1", "2026-08-05T00:00:00Z")])
    );

    const result = await detectNewCollectionProducts({
      integration,
      collectionId: "gid://shopify/Collection/1",
      since: "2026-08-05T00:00:00Z",
    });

    // Inclusive would re-classify and re-charge the same product every run.
    expect(result.products).toEqual([]);
  });

  it("pages on until it reaches the watermark", async () => {
    shopifyGraphQL
      .mockResolvedValueOnce(
        page([node("gid://p/3", "2026-08-10T12:00:00Z")], true, "cursor-1")
      )
      .mockResolvedValueOnce(
        page([
          node("gid://p/2", "2026-08-09T12:00:00Z"),
          node("gid://p/1", "2026-08-01T12:00:00Z"),
        ])
      );

    const result = await detectNewCollectionProducts({
      integration,
      collectionId: "gid://shopify/Collection/1",
      since: "2026-08-05T00:00:00Z",
    });

    expect(result.products.map((p) => p.id)).toEqual(["gid://p/3", "gid://p/2"]);
    expect(shopifyGraphQL.mock.calls[1][0]).toMatchObject({
      variables: expect.objectContaining({ after: "cursor-1" }),
    });
  });

  it("flags a walk that ran out of pages while still finding new products", async () => {
    shopifyGraphQL.mockResolvedValue(
      page([node("gid://p/9", "2026-08-10T12:00:00Z")], true, "cursor-n")
    );

    const result = await detectNewCollectionProducts({
      integration,
      collectionId: "gid://shopify/Collection/1",
      since: "2026-08-05T00:00:00Z",
      maxPages: 2,
    });

    // The caller needs to know the rest is coming next run, not lost.
    expect(result.truncated).toBe(true);
    expect(shopifyGraphQL).toHaveBeenCalledTimes(2);
  });

  it("carries the fields the classifier reads", async () => {
    shopifyGraphQL.mockResolvedValue(
      page([
        node("gid://p/1", "2026-08-10T12:00:00Z", {
          productType: "Cables",
          featuredImage: { url: "https://cdn.example/p1.jpg" },
          onlineStoreUrl: "https://shop.example/products/p1",
        }),
      ])
    );

    const [product] = (
      await detectNewCollectionProducts({
        integration,
        collectionId: "gid://shopify/Collection/1",
        since: "2026-08-05T00:00:00Z",
      })
    ).products;

    expect(product).toMatchObject({
      productType: "Cables",
      imageUrl: "https://cdn.example/p1.jpg",
      url: "https://shop.example/products/p1",
    });
  });

  it("fails loudly on a missing collection instead of reporting nothing new", async () => {
    shopifyGraphQL.mockResolvedValue({ data: { collection: null }, errors: [] });

    await expect(
      detectNewCollectionProducts({
        integration,
        collectionId: "gid://shopify/Collection/404",
        since: "2026-08-05T00:00:00Z",
      })
    ).rejects.toThrow(/Collection not found/);
  });

  it("rejects an unparseable watermark rather than walking the whole collection", async () => {
    await expect(
      detectNewCollectionProducts({
        integration,
        collectionId: "gid://shopify/Collection/1",
        since: "not a date",
      })
    ).rejects.toThrow(/Invalid watermark/);
    expect(shopifyGraphQL).not.toHaveBeenCalled();
  });
});

describe("removeProductsFromCollection", () => {
  it("surfaces a user error from the mutation", async () => {
    shopifyGraphQL.mockResolvedValue({
      data: {
        collectionRemoveProducts: {
          job: null,
          userErrors: [{ field: ["id"], message: "Collection is automated" }],
        },
      },
      errors: [],
    });

    await expect(
      removeProductsFromCollection({
        integration,
        collectionId: "gid://shopify/Collection/1",
        productIds: ["gid://p/1"],
      })
    ).rejects.toThrow(/Collection is automated/);
  });

  it("returns the job reference for an asynchronous removal", async () => {
    shopifyGraphQL.mockResolvedValue({
      data: {
        collectionRemoveProducts: {
          job: { id: "gid://shopify/Job/1", done: false },
          userErrors: [],
        },
      },
      errors: [],
    });

    const result = await removeProductsFromCollection({
      integration,
      collectionId: "gid://shopify/Collection/1",
      productIds: ["gid://p/1", "gid://p/2"],
    });

    expect(result.removedCount).toBe(2);
    expect(result.pendingJobRef).toBe("gid://shopify/Job/1");
  });
});

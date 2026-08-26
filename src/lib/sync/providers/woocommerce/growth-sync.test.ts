import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationRecord } from "@/lib/sync/core/types";

const get = vi.fn();
const post = vi.fn();

vi.mock("./client", () => ({
  createWooClient: () => ({ get, post }),
}));

const {
  detectNewWooCategoryProducts,
  listAllWooCategories,
  unassignProductsFromWooCategory,
} = await import("./categories");

const integration: IntegrationRecord = {
  provider: "woocommerce",
  integration_name: "Test Store",
  base_url: "https://test.example",
  config: { consumer_key: "ck_test", consumer_secret: "cs_test" },
};

function wooProduct(id: number, createdGmt: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Product ${id}`,
    date_created_gmt: createdGmt,
    ...extra,
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("detectNewWooCategoryProducts", () => {
  it("returns nothing without calling the store when there is no watermark yet", async () => {
    const result = await detectNewWooCategoryProducts({
      integration,
      categoryId: "12",
      since: null,
    });

    expect(result.products).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("lets WooCommerce filter by date server-side", async () => {
    get.mockResolvedValue([]);

    await detectNewWooCategoryProducts({
      integration,
      categoryId: "12",
      since: "2026-08-05T00:00:00Z",
    });

    // The whole point of the Woo path: no local watermark comparison.
    expect(get).toHaveBeenCalledWith(
      "/products",
      expect.objectContaining({
        category: 12,
        after: "2026-08-05T00:00:00Z",
        dates_are_gmt: true,
        orderby: "date",
        order: "desc",
      })
    );
  });

  it("takes the newest creation time from the first result", async () => {
    get.mockResolvedValue([
      wooProduct(3, "2026-08-10T12:00:00"),
      wooProduct(2, "2026-08-06T12:00:00"),
    ]);

    const result = await detectNewWooCategoryProducts({
      integration,
      categoryId: "12",
      since: "2026-08-05T00:00:00Z",
    });

    expect(result.products.map((p) => p.id)).toEqual(["3", "2"]);
    // The GMT field carries no offset, so a Z is appended to keep the watermark
    // comparable with the ISO timestamps every other provider returns.
    expect(result.newestCreatedAt).toBe("2026-08-10T12:00:00Z");
  });

  it("carries the fields the classifier reads", async () => {
    get.mockResolvedValue([
      wooProduct(1, "2026-08-10T12:00:00", {
        permalink: "https://shop.example/product/p1",
        type: "simple",
        short_description: "A short one",
        description: "A much longer one",
        tags: [{ name: "usb-c" }, { name: "" }],
        images: [{ src: "https://cdn.example/p1.jpg" }, { src: "https://cdn.example/p2.jpg" }],
      }),
    ]);

    const [product] = (
      await detectNewWooCategoryProducts({
        integration,
        categoryId: "12",
        since: "2026-08-05T00:00:00Z",
      })
    ).products;

    expect(product).toMatchObject({
      url: "https://shop.example/product/p1",
      imageUrl: "https://cdn.example/p1.jpg",
      productType: "simple",
      tags: ["usb-c"],
      description: "A short one",
    });
  });

  it("stops paging as soon as a page comes back short", async () => {
    get.mockResolvedValue([wooProduct(1, "2026-08-10T12:00:00")]);

    await detectNewWooCategoryProducts({
      integration,
      categoryId: "12",
      since: "2026-08-05T00:00:00Z",
    });

    expect(get).toHaveBeenCalledTimes(1);
  });

  it("pages on while every page comes back full", async () => {
    const full = Array.from({ length: 100 }, (_, i) =>
      wooProduct(i + 1, "2026-08-10T12:00:00")
    );
    get.mockResolvedValueOnce(full).mockResolvedValueOnce([wooProduct(200, "2026-08-09T12:00:00")]);

    const result = await detectNewWooCategoryProducts({
      integration,
      categoryId: "12",
      since: "2026-08-05T00:00:00Z",
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][1]).toMatchObject({ page: 2 });
    expect(result.products).toHaveLength(101);
    expect(result.truncated).toBeUndefined();
  });

  it("rejects a category id that is not numeric", async () => {
    await expect(
      detectNewWooCategoryProducts({
        integration,
        categoryId: "gid://shopify/Collection/1",
        since: "2026-08-05T00:00:00Z",
      })
    ).rejects.toThrow(/Invalid WooCommerce category id/);
  });
});

describe("listAllWooCategories", () => {
  it("reports every category as hand-editable", async () => {
    get.mockResolvedValue([
      { id: 12, name: "Cables", slug: "cables", count: 40 },
      { id: 13, name: "Stands", slug: "stands", count: 0 },
    ]);

    const categories = await listAllWooCategories({ integration });

    expect(categories).toEqual([
      { id: "12", title: "Cables", handle: "cables", productCount: 40, manual: true },
      { id: "13", title: "Stands", handle: "stands", productCount: 0, manual: true },
    ]);
    // Empty categories are still valid destinations, so they must not be hidden.
    expect(get.mock.calls[0][1]).toMatchObject({ hide_empty: false });
  });
});

describe("unassignProductsFromWooCategory", () => {
  it("removes only the target category and keeps the others", async () => {
    get.mockResolvedValue([
      { id: 1, categories: [{ id: 12 }, { id: 30 }] },
      { id: 2, categories: [{ id: 12 }] },
    ]);
    post.mockResolvedValue({});

    const result = await unassignProductsFromWooCategory({
      integration,
      categoryId: "12",
      productIds: ["1", "2"],
    });

    expect(result.removedCount).toBe(2);
    expect(post).toHaveBeenCalledWith("/products/batch", {
      update: [
        { id: 1, categories: [{ id: 30 }] },
        { id: 2, categories: [] },
      ],
    });
  });

  it("writes nothing when the product is already out of the category", async () => {
    get.mockResolvedValue([{ id: 1, categories: [{ id: 30 }] }]);

    const result = await unassignProductsFromWooCategory({
      integration,
      categoryId: "12",
      productIds: ["1"],
    });

    expect(result.removedCount).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });
});

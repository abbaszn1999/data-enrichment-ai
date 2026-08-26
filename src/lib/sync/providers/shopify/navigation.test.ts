import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationRecord } from "@/lib/sync/core/types";

const shopifyGraphQL = vi.fn();

vi.mock("./graphql-client", () => ({
  shopifyGraphQL: (args: unknown) => shopifyGraphQL(args),
}));

const { fetchShopifyNavigationMenus, SHOPIFY_NAVIGATION_SCOPE_HINT } = await import("./navigation");

const integration: IntegrationRecord = {
  provider: "shopify",
  integration_name: "Test Store",
  base_url: "https://test.myshopify.com",
  config: { access_token: "shpat_test" },
};

beforeEach(() => {
  shopifyGraphQL.mockReset();
});

describe("fetchShopifyNavigationMenus", () => {
  it("converts a nested menu into NavigationMenu/NavigationItem trees", async () => {
    shopifyGraphQL.mockResolvedValue({
      data: {
        menus: {
          edges: [
            {
              node: {
                id: "gid://shopify/Menu/1",
                title: "Main menu",
                handle: "main-menu",
                items: [
                  {
                    id: "1",
                    title: "Shop",
                    type: "HTTP",
                    url: "/collections/shop",
                    resourceId: "gid://shopify/Collection/1",
                    items: [
                      {
                        id: "1-1",
                        title: "Sneakers",
                        type: "HTTP",
                        url: "/collections/sneakers",
                        items: [],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
      errors: [],
    });

    const result = await fetchShopifyNavigationMenus({ integration });

    expect(result.unavailableReason).toBeUndefined();
    expect(result.menus).toEqual([
      {
        id: "gid://shopify/Menu/1",
        title: "Main menu",
        handle: "main-menu",
        items: [
          {
            title: "Shop",
            url: "/collections/shop",
            resourceId: "gid://shopify/Collection/1",
            children: [
              {
                title: "Sneakers",
                url: "/collections/sneakers",
                resourceId: undefined,
                children: undefined,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("degrades to an unavailableReason instead of throwing on a missing scope", async () => {
    shopifyGraphQL.mockResolvedValue({
      data: null,
      errors: [{ message: "Access denied for menus field. Required access: read_online_store_navigation." }],
    });

    const result = await fetchShopifyNavigationMenus({ integration });

    expect(result.menus).toEqual([]);
    expect(result.unavailableReason).toBe(SHOPIFY_NAVIGATION_SCOPE_HINT);
  });

  it("degrades to an unavailableReason when the client throws an access-denied error", async () => {
    shopifyGraphQL.mockRejectedValue(new Error("Access denied for menus field"));

    const result = await fetchShopifyNavigationMenus({ integration });

    expect(result.menus).toEqual([]);
    expect(result.unavailableReason).toBe(SHOPIFY_NAVIGATION_SCOPE_HINT);
  });

  it("rethrows non-access-denied errors", async () => {
    shopifyGraphQL.mockRejectedValue(new Error("network timeout"));

    await expect(fetchShopifyNavigationMenus({ integration })).rejects.toThrow("network timeout");
  });

  it("rethrows other GraphQL error messages instead of swallowing them", async () => {
    shopifyGraphQL.mockResolvedValue({
      data: null,
      errors: [{ message: "Throttled" }],
    });

    await expect(fetchShopifyNavigationMenus({ integration })).rejects.toThrow("menus query: Throttled");
  });
});

// Shopify Online Store navigation — read-only, for tools that need the
// store's real menu structure (Website Restructure) instead of guessing it
// from the flat collection list.
//
// Verified against:
//   https://shopify.dev/docs/api/admin-graphql/latest/queries/menus
//   https://shopify.dev/docs/api/admin-graphql/latest/objects/Menu
//
// Requires the `read_online_store_navigation` scope, which most integrations
// created for product/inventory sync do not request. A missing scope must
// degrade to "no navigation available" rather than fail the caller, since
// every other Website Restructure step (taxonomy, images) still works.

import type {
  IntegrationRecord,
  NavigationItem,
  NavigationMenu,
} from "@/lib/sync/core/types";
import { shopifyGraphQL } from "./graphql-client";
import { isShopifyAccessDenied } from "./articles";

export const SHOPIFY_NAVIGATION_SCOPE_HINT =
  "This store's Shopify app is missing navigation permissions. In Shopify admin open Settings › Apps and sales channels › Develop apps › your app › Configuration, enable read_online_store_navigation, then reinstall the app.";

// Three levels deep covers every real-world mega menu (top link → column →
// column item); Shopify's own admin menu editor caps nesting at the same
// depth, so a fourth level would never have data to fill it.
const MENUS_QUERY = /* GraphQL */ `
  query NavigationMenus($first: Int!) {
    menus(first: $first) {
      edges {
        node {
          id
          title
          handle
          items {
            id
            title
            type
            url
            resourceId
            items {
              id
              title
              type
              url
              resourceId
              items {
                id
                title
                type
                url
                resourceId
              }
            }
          }
        }
      }
    }
  }
`;

type RawMenuItem = {
  id?: string;
  title?: string;
  type?: string;
  url?: string | null;
  resourceId?: string | null;
  items?: RawMenuItem[] | null;
};

type RawMenu = {
  id?: string;
  title?: string;
  handle?: string;
  items?: RawMenuItem[] | null;
};

function toNavigationItem(node: RawMenuItem): NavigationItem {
  return {
    title: node.title ?? "",
    url: node.url ?? "",
    resourceId: node.resourceId ?? undefined,
    children: Array.isArray(node.items) && node.items.length > 0
      ? node.items.map(toNavigationItem)
      : undefined,
  };
}

/**
 * Every navigation menu on the store (Main menu, Footer menu, …), with items
 * nested up to three levels — enough to reconstruct a mega menu's columns.
 *
 * Never throws: a missing `read_online_store_navigation` scope is reported
 * back as `unavailableReason` so the caller can fall back to reasoning from
 * the flat taxonomy list plus the uploaded header screenshots.
 */
export async function fetchShopifyNavigationMenus(input: {
  integration: IntegrationRecord;
  max?: number;
}): Promise<{ menus: NavigationMenu[]; unavailableReason?: string }> {
  try {
    const res = await shopifyGraphQL<{
      menus: { edges: Array<{ node: RawMenu }> };
    }>({
      integration: input.integration,
      query: MENUS_QUERY,
      variables: { first: Math.min(Math.max(input.max ?? 10, 1), 25) },
      options: { estimatedCost: 10, tag: "menus" },
    });

    if (res.errors.length > 0) {
      const message = res.errors[0].message;
      if (isShopifyAccessDenied(message)) {
        return { menus: [], unavailableReason: SHOPIFY_NAVIGATION_SCOPE_HINT };
      }
      throw new Error(`menus query: ${message}`);
    }

    const edges = res.data?.menus?.edges ?? [];
    const menus: NavigationMenu[] = edges.map(({ node }) => ({
      id: String(node.id ?? ""),
      title: String(node.title ?? ""),
      handle: node.handle ?? undefined,
      items: (node.items ?? []).map(toNavigationItem),
    }));
    return { menus };
  } catch (error) {
    if (isShopifyAccessDenied(error)) {
      return { menus: [], unavailableReason: SHOPIFY_NAVIGATION_SCOPE_HINT };
    }
    throw error;
  }
}

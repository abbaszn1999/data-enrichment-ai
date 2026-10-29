import { describe, expect, it } from "vitest";
import { ALL_SHOPIFY_SCOPES, SHOPIFY_TOOL_ACCESS, hasShopifyScope, missingShopifyScopes } from "./shopify-access";

describe("shopify access", () => {
  it("counts a write scope as its read scope too", () => {
    const granted = new Set(["write_products"]);
    expect(hasShopifyScope(granted, "read_products")).toBe(true);
    expect(hasShopifyScope(granted, "write_products")).toBe(true);
    expect(hasShopifyScope(granted, "write_inventory")).toBe(false);
    expect(hasShopifyScope(new Set(["read_products"]), "write_products")).toBe(false);
  });

  it("lists what each tool is missing", () => {
    const granted = ["write_products", "read_online_store_navigation"];
    const missing = Object.fromEntries(SHOPIFY_TOOL_ACCESS.map((t) => [t.id, missingShopifyScopes(granted, t.scopes)]));
    expect(missing["growth-sync"]).toEqual([]);
    expect(missing["website-restructure"]).toEqual([]);
    expect(missing["market-research"]).toEqual(["read_publications", "write_publications", "read_content", "write_content"]);
    expect(missing["store-assistant"]).toContain("write_inventory");
  });

  it("gives every scope once, and a full grant makes every tool ready", () => {
    expect(new Set(ALL_SHOPIFY_SCOPES).size).toBe(ALL_SHOPIFY_SCOPES.length);
    for (const tool of SHOPIFY_TOOL_ACCESS) expect(missingShopifyScopes(ALL_SHOPIFY_SCOPES, tool.scopes)).toEqual([]);
  });
});

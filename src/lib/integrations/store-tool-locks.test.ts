import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_SHOPIFY_SCOPES, storeToolLocks } from "./shopify-access";
import { storeToolBlock, grantedScopesFromTest } from "./store-scopes";

describe("store tool locks", () => {
  it("locks Website Restructure without navigation access, even with read_products", () => {
    const locks = storeToolLocks("shopify", ["read_products", "write_products"]);
    expect(locks["website-restructure"]).toEqual({ reason: "missing-scopes", missing: ["read_online_store_navigation"] });
    expect(locks["growth-sync"]).toBeNull();
    expect(locks["market-research"]).toMatchObject({ reason: "missing-scopes", missing: ["read_publications", "write_publications", "read_content", "write_content"] });
  });

  it("opens the Store Assistant with read_products alone, and only with it", () => {
    expect(storeToolLocks("shopify", ["read_products"])["store-assistant"]).toBeNull();
    expect(storeToolLocks("shopify", ["write_products"])["store-assistant"]).toBeNull();
    expect(storeToolLocks("shopify", ["read_inventory"])["store-assistant"]).toEqual({ reason: "missing-scopes", missing: ["read_products"] });
  });

  it("opens everything when every scope is granted", () => {
    expect(Object.values(storeToolLocks("shopify", ALL_SHOPIFY_SCOPES)).every((lock) => lock === null)).toBe(true);
  });

  it("handles no store, other platforms and unknown scopes", () => {
    expect(storeToolLocks(null, null)["growth-sync"]).toEqual({ reason: "no-store" });
    expect(storeToolLocks("woocommerce", null)["website-restructure"]).toBeNull();
    expect(storeToolLocks("woocommerce", null)["store-assistant"]).toBeNull();
    expect(storeToolLocks("wordpress", null)["store-assistant"]).toEqual({ reason: "unsupported-store" });
    expect(storeToolLocks("wordpress", null)["website-restructure"]).toBeNull();
    // Shopify could not be asked: nothing is locked by a failed check.
    expect(storeToolLocks("shopify", null)["website-restructure"]).toBeNull();
  });
});

const dbWith = (row: unknown) =>
  ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
    }),
  }) as unknown as SupabaseClient;

describe("the server enforces the same locks", () => {
  const fresh = new Date().toISOString();

  it("refuses a tool whose scopes are missing, naming them", async () => {
    const res = await storeToolBlock(dbWith({ provider: "shopify", base_url: "https://x.myshopify.com", config: {}, granted_scopes: ["read_products"], scopes_checked_at: fresh }), "w1", "website-restructure");
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: "MISSING_SCOPES", missing: ["read_online_store_navigation"] });
  });

  it("lets a tool through when it has what it needs, or the platform has no scopes", async () => {
    expect(await storeToolBlock(dbWith({ provider: "shopify", base_url: "https://x.myshopify.com", config: {}, granted_scopes: ["read_products"], scopes_checked_at: fresh }), "w1", "store-assistant")).toBeNull();
    expect(await storeToolBlock(dbWith({ provider: "woocommerce", base_url: "https://x.example", config: {}, granted_scopes: null, scopes_checked_at: null }), "w1", "market-research")).toBeNull();
  });

  it("keeps a connection test's scopes for Shopify only", () => {
    expect(grantedScopesFromTest("shopify", { grantedScopes: ["read_products"] }).granted_scopes).toEqual(["read_products"]);
    expect(grantedScopesFromTest("woocommerce", { grantedScopes: ["x"] })).toEqual({ granted_scopes: null, scopes_checked_at: null });
    expect(grantedScopesFromTest("shopify", {})).toEqual({ granted_scopes: null, scopes_checked_at: null });
  });
});

import { describe, it, expect } from "vitest";
import {
  buildProviderToolContext,
  buildToolSchemasForProvider,
  describeToolForProvider,
  listToolsForProvider,
} from "./tool-catalog";

const shopify = buildProviderToolContext("shopify");
const woo = buildProviderToolContext("woocommerce");

/** Declared argument names of an object schema, as the model would see them. */
const argNames = (schema: unknown): string[] =>
  Object.keys((schema as { shape?: Record<string, unknown> }).shape ?? {});

describe("provider-scoped tool schemas", () => {
  it("keeps WooCommerce-only columns out of a Shopify session", () => {
    const schemas = buildToolSchemasForProvider(shopify);
    const write = schemas.sync_columns_write_with_ai;

    expect(
      write.safeParse({ targetColumn: "body_html", instruction: "x" }).success
    ).toBe(true);
    // `categories` / `short_description` exist only on WooCommerce.
    expect(
      write.safeParse({ targetColumn: "categories", instruction: "x" }).success
    ).toBe(false);
    expect(
      write.safeParse({ targetColumn: "short_description", instruction: "x" }).success
    ).toBe(false);
  });

  it("keeps Shopify-only columns out of a WooCommerce session", () => {
    const write = buildToolSchemasForProvider(woo).sync_columns_write_with_ai;

    expect(
      write.safeParse({ targetColumn: "categories", instruction: "x" }).success
    ).toBe(true);
    // `vendor` / `product_type` / `description` are Shopify-shaped.
    expect(
      write.safeParse({ targetColumn: "vendor", instruction: "x" }).success
    ).toBe(false);
    expect(
      write.safeParse({ targetColumn: "product_type", instruction: "x" }).success
    ).toBe(false);
  });

  it("drops serverFilter for a provider that cannot filter server-side", () => {
    const shopifyLoad = buildToolSchemasForProvider(shopify).sync_products_load;
    const wooLoad = buildToolSchemasForProvider(woo).sync_products_load;

    const args = { columnProfile: "core", serverFilter: { vendor: "Acme" } };
    const shopifyParsed = shopifyLoad.safeParse(args);
    const wooParsed = wooLoad.safeParse(args);

    expect(shopifyParsed.success).toBe(true);
    expect(
      (shopifyParsed as { data: Record<string, unknown> }).data.serverFilter
    ).toBeDefined();

    // Woo has no server-side filter keys, so the field is not part of its
    // schema. Passthrough still accepts the object without validating it — what
    // matters is that the declaration sent to the model never advertises it.
    expect(wooParsed.success).toBe(true);
    expect(argNames(wooLoad)).not.toContain("serverFilter");
    expect(argNames(shopifyLoad)).toContain("serverFilter");
  });

  it("scopes columnProfile to the provider's own tabs", () => {
    const wooLoad = buildToolSchemasForProvider(woo).sync_products_load;
    // WooCommerce declares no `publishing` / `metafields` tabs.
    expect(wooLoad.safeParse({ columnProfile: "taxonomy" }).success).toBe(true);
    expect(wooLoad.safeParse({ columnProfile: "metafields" }).success).toBe(false);
  });

  it("offers smart rule sets only where they exist", () => {
    const shopifyCreate = buildToolSchemasForProvider(shopify).sync_collections_create;
    const wooCreate = buildToolSchemasForProvider(woo).sync_collections_create;

    expect(argNames(shopifyCreate)).toContain("ruleSet");
    expect(argNames(shopifyCreate)).not.toContain("parent");
    expect(argNames(wooCreate)).toContain("parent");
    expect(argNames(wooCreate)).not.toContain("ruleSet");
  });
});

describe("provider-scoped tool descriptions", () => {
  it("uses each platform's taxonomy vocabulary", () => {
    expect(describeToolForProvider("sync_collections_load", shopify)).toContain(
      "Collections"
    );
    expect(describeToolForProvider("sync_collections_load", woo)).toContain(
      "Categories"
    );
  });

  it("tells the model when server-side filtering is unavailable", () => {
    expect(describeToolForProvider("sync_products_load", woo)).toContain(
      "cannot filter server-side"
    );
    expect(describeToolForProvider("sync_products_load", shopify)).toContain(
      "serverFilter"
    );
  });

  it("lists only the connected platform's writable columns", () => {
    const desc = describeToolForProvider("sync_columns_write_with_ai", shopify);
    expect(desc).toContain("body_html");
    expect(desc).not.toContain("short_description");
  });
});

describe("tool availability", () => {
  it("exposes taxonomy writes for providers that implement them", () => {
    expect(listToolsForProvider(shopify)).toContain("sync_collections_delete");
    expect(listToolsForProvider(woo)).toContain("sync_collections_delete");
  });

  it("hides taxonomy writes when no integration is connected", () => {
    const none = buildProviderToolContext(null);
    expect(none.supportsTaxonomyWrites).toBe(false);
    expect(listToolsForProvider(none)).not.toContain("sync_collections_delete");
    expect(listToolsForProvider(none)).toContain("sync_reply_only");
  });
});

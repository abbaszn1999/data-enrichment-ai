import { describe, expect, it } from "vitest";
import { inspectShopifyDocument } from "../../src/store-agent/shopify/guard";
import { IDEMPOTENCY_VARIABLE, idempotencyVariables, withIdempotency } from "../../src/store-agent/shopify/idempotency";

describe("idempotent inventory mutations", () => {
  it("adds the directive, keyed by a variable, where Shopify requires it", () => {
    const doc = withIdempotency(
      `mutation ($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { message } } }`
    )!;
    expect(doc).toContain(`$${IDEMPOTENCY_VARIABLE}: String!`);
    expect(doc).toContain(`inventorySetQuantities(input: $input) @idempotent(key: $${IDEMPOTENCY_VARIABLE})`);
    // Still passes the store guard.
    expect(inspectShopifyDocument(doc, idempotencyVariables({ input: {} })).ok).toBe(true);
  });

  it("leaves other mutations, and ones that already have it, alone", () => {
    expect(withIdempotency(`mutation { productUpdate(product: { id: "gid://shopify/Product/1", title: "x" }) { product { id } } }`)).toBeNull();
    expect(withIdempotency(`mutation { inventoryActivate(inventoryItemId: "a", locationId: "b") @idempotent(key: "k") { userErrors { message } } }`)).toBeNull();
  });

  it("moves a directive put on the operation onto the field", () => {
    const doc = withIdempotency(
      `mutation Activate($item: ID!, $loc: ID!) @idempotent(key: "abc") { inventoryActivate(inventoryItemId: $item, locationId: $loc) { userErrors { message } } }`
    )!;
    expect(doc).toMatch(/mutation Activate\(\$item: ID!, \$loc: ID!, \$autommerceIdempotencyKey: String!\) \{/);
    expect(doc).toContain("inventoryActivate(inventoryItemId: $item, locationId: $loc) @idempotent(key: $autommerceIdempotencyKey)");
  });

  it("gives every execution its own key", () => {
    const a = idempotencyVariables({ input: 1 });
    const b = idempotencyVariables({ input: 1 });
    expect(a.input).toBe(1);
    expect(a[IDEMPOTENCY_VARIABLE]).not.toBe(b[IDEMPOTENCY_VARIABLE]);
  });
});

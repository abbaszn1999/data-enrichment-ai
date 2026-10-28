import { describe, expect, it } from "vitest";
import { inspectShopifyDocument, missingScopes } from "../../src/store-agent/shopify/guard";

const allow = (doc: string, vars?: Record<string, unknown>) => {
  const v = inspectShopifyDocument(doc, vars);
  if (!v.ok) throw new Error(`expected allow, got: ${v.reason}`);
  return v;
};
const refuse = (doc: string, vars?: Record<string, unknown>) => {
  const v = inspectShopifyDocument(doc, vars);
  if (v.ok) throw new Error(`expected refusal for: ${doc}`);
  return v.reason;
};

describe("Shopify guard: reads", () => {
  it("allows product, collection, inventory, location, file and channel reads", () => {
    const v = allow(`{
      products(first: 5) { nodes { id title variants(first: 3) { nodes { id sku inventoryItem { id } } } } }
      collections(first: 5) { nodes { id title } }
      locations(first: 5) { nodes { id name } }
      files(first: 5) { nodes { id alt } }
      publications(first: 5) { nodes { id name } }
    }`);
    expect(v.risk).toBe("read");
    expect(v.requiredScopes.sort()).toEqual(
      ["read_files", "read_locations", "read_products", "read_publications"].sort()
    );
  });

  it("allows shop basics and introspection", () => {
    expect(allow("{ shop { name currencyCode } }").risk).toBe("read");
    expect(allow("{ __type(name: \"Product\") { fields { name } } }").ok).toBe(true);
    expect(allow("{ currentAppInstallation { accessScopes { handle } } }").ok).toBe(true);
  });

  it("refuses roots outside the scopes and says why", () => {
    expect(refuse("{ orders(first: 5) { nodes { id } } }")).toMatch(/outside what this agent can access/);
    expect(refuse("{ customers(first: 5) { nodes { id } } }")).toMatch(/outside/);
    expect(refuse("{ discountNodes(first: 5) { nodes { id } } }")).toMatch(/outside/);
    expect(refuse("{ themes(first: 5) { nodes { id } } }")).toMatch(/outside/);
  });

  it("refuses forbidden data reached through nesting", () => {
    expect(refuse("{ shop { name orders(first: 1) { nodes { id } } } }")).toMatch(/orders/);
    expect(refuse("{ locations(first: 1) { nodes { id fulfillmentOrders(first: 1) { nodes { id } } } } }")).toMatch(/fulfillmentOrders/);
  });

  it("refuses forbidden fields hidden in fragments", () => {
    expect(refuse("query { shop { ...S } } fragment S on Shop { name orders(first:1) { nodes { id } } }")).toMatch(/orders/);
  });

  it("checks every id by type, literal or variable", () => {
    expect(allow('{ node(id: "gid://shopify/Product/1") { id } }').ids).toEqual(["gid://shopify/Product/1"]);
    expect(refuse('{ node(id: "gid://shopify/Order/1") { id } }')).toMatch(/Order/);
    expect(refuse("query($id: ID!) { node(id: $id) { id } }", { id: "gid://shopify/Customer/9" })).toMatch(/Customer/);
    expect(refuse("query($ids: [ID!]!) { nodes(ids: $ids) { id } }", { ids: ["gid://shopify/Product/1", "gid://shopify/DraftOrder/2"] })).toMatch(/DraftOrder/);
  });
});

describe("Shopify guard: writes", () => {
  it("classifies edits as write with the right scope", () => {
    const v = allow(
      "mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { id } userErrors { field message } } }",
      { p: { id: "gid://shopify/Product/1", descriptionHtml: "<p>x</p>" } }
    );
    expect(v.kind).toBe("mutation");
    expect(v.risk).toBe("write");
    expect(v.requiredScopes).toEqual(["write_products"]);
  });

  it("classifies deletes as delete", () => {
    expect(allow('mutation { productDelete(input: {id: "gid://shopify/Product/1"}) { deletedProductId } }').risk).toBe("delete");
    expect(allow('mutation { collectionDelete(input: {id: "gid://shopify/Collection/1"}) { deletedCollectionId } }').risk).toBe("delete");
    expect(allow('mutation { fileDelete(fileIds: ["gid://shopify/MediaImage/1"]) { deletedFileIds } }').risk).toBe("delete");
  });

  it("takes the highest risk when a mutation mixes operations", () => {
    const v = allow(`mutation {
      a: productUpdate(product: {id: "gid://shopify/Product/1", title: "x"}) { product { id } }
      b: productDelete(input: {id: "gid://shopify/Product/2"}) { deletedProductId }
    }`);
    expect(v.risk).toBe("delete");
    expect(v.operations).toEqual(["productUpdate", "productDelete"]);
  });

  it("covers inventory, locations, files and publications", () => {
    expect(allow("mutation($i: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $i) { userErrors { message } } }").requiredScopes).toEqual(["write_inventory"]);
    expect(allow('mutation { locationEdit(id: "gid://shopify/Location/1", input: {name: "A"}) { location { id } } }').requiredScopes).toEqual(["write_locations"]);
    expect(allow("mutation($f: [FileCreateInput!]!) { fileCreate(files: $f) { files { id } } }").requiredScopes).toEqual(["write_files"]);
    expect(allow('mutation { publishablePublish(id: "gid://shopify/Product/1", input: [{publicationId: "gid://shopify/Publication/1"}]) { userErrors { message } } }').requiredScopes).toEqual(["write_publications"]);
  });

  it("refuses tags or metafields on records outside the scopes", () => {
    expect(allow('mutation { tagsAdd(id: "gid://shopify/Product/1", tags: ["sale"]) { node { id } } }').ok).toBe(true);
    expect(refuse('mutation { tagsAdd(id: "gid://shopify/Order/1", tags: ["x"]) { node { id } } }')).toMatch(/Order/);
    expect(refuse("mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { metafields { id } } }", { m: [{ ownerId: "gid://shopify/Customer/1", namespace: "a", key: "b", value: "c", type: "single_line_text_field" }] })).toMatch(/Customer/);
  });

  it("refuses mutations outside the scopes", () => {
    expect(refuse("mutation { orderUpdate(input: {id: \"gid://shopify/Order/1\"}) { order { id } } }")).toMatch(/outside/);
    expect(refuse("mutation { customerCreate(input: {}) { customer { id } } }")).toMatch(/outside/);
    expect(refuse("mutation { discountCodeBasicCreate(basicCodeDiscount: {}) { userErrors { message } } }")).toMatch(/outside/);
    expect(refuse("mutation { translationsRegister(resourceId: \"gid://shopify/Product/1\", translations: []) { userErrors { message } } }")).toMatch(/outside/);
  });
});

describe("Shopify guard: bulk operations", () => {
  it("allows a bulk query whose inner query is in scope", () => {
    const v = allow('mutation { bulkOperationRunQuery(query: "{ products { edges { node { id title } } } }") { bulkOperation { id } } }');
    expect(v.risk).toBe("read");
    expect(v.requiredScopes).toEqual(["read_products"]);
  });

  it("refuses a bulk query that reads orders, also via variables", () => {
    expect(refuse('mutation { bulkOperationRunQuery(query: "{ orders { edges { node { id } } } }") { bulkOperation { id } } }')).toMatch(/Inside bulkOperationRunQuery/);
    expect(refuse("mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id } } }", { q: "{ customers { edges { node { id } } } }" })).toMatch(/customers/);
  });

  it("marks bulk mutations as bulk and checks the inner mutation", () => {
    const v = allow('mutation { bulkOperationRunMutation(mutation: "mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { id } } }", stagedUploadPath: "x") { bulkOperation { id } } }');
    expect(v.risk).toBe("bulk");
    expect(v.requiredScopes).toEqual(["write_products"]);
    expect(refuse('mutation { bulkOperationRunMutation(mutation: "mutation { orderUpdate(input: {}) { order { id } } }", stagedUploadPath: "x") { bulkOperation { id } } }')).toMatch(/orderUpdate/);
  });

  it("requires the inner document to be a literal or a provided variable", () => {
    expect(refuse("mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id } } }")).toMatch(/inner document/);
  });
});

describe("Shopify guard: malformed input", () => {
  it("refuses empty, unparsable, multi-operation and subscription documents", () => {
    expect(refuse("")).toMatch(/empty/);
    expect(refuse("{ products(first: 1) { nodes { id }")).toMatch(/does not parse/);
    expect(refuse("query A { shop { name } } query B { shop { name } }")).toMatch(/exactly one/);
    expect(refuse("subscription { productUpdated { id } }")).toMatch(/Subscriptions/);
  });

  it("refuses documents nested too deeply", () => {
    let inner = "id";
    for (let i = 0; i < 20; i++) inner = `collections(first:1) { nodes { ${inner} } }`;
    expect(refuse(`{ ${inner} }`)).toMatch(/too deeply/);
  });
});

describe("missingScopes", () => {
  it("treats a write scope as covering its read scope", () => {
    expect(missingScopes(["read_products", "write_inventory"], new Set(["write_products"]))).toEqual(["write_inventory"]);
    expect(missingScopes(["read_files"], new Set(["read_files"]))).toEqual([]);
  });
});

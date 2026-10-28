/**
 * What the Store Agent may do on a Shopify store.
 *
 * Product decision: the agent works with exactly these access scopes. Anything
 * outside them (orders, customers, discounts, themes, content, …) is refused
 * and the agent says so plainly, even when the store's token would allow it.
 */
export const STORE_AGENT_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "write_locations",
  "read_files",
  "write_files",
  "read_publications",
  "write_publications",
] as const;

export type StoreAgentScope = (typeof STORE_AGENT_SCOPES)[number];

/** How much the user must be involved before an operation runs. */
export type OperationRisk = "read" | "write" | "delete" | "bulk";

type RootRule = { scope: StoreAgentScope | null; risk: OperationRisk };

const read = (scope: StoreAgentScope | null): RootRule => ({ scope, risk: "read" });
const write = (scope: StoreAgentScope): RootRule => ({ scope, risk: "write" });
const del = (scope: StoreAgentScope): RootRule => ({ scope, risk: "delete" });

/** Query root fields the agent may call. Anything not listed is refused. */
export const QUERY_ROOTS: Record<string, RootRule> = {
  // Products and collections (read_products)
  product: read("read_products"),
  products: read("read_products"),
  productByHandle: read("read_products"),
  productByIdentifier: read("read_products"),
  productsCount: read("read_products"),
  productVariant: read("read_products"),
  productVariantByIdentifier: read("read_products"),
  productVariants: read("read_products"),
  productVariantsCount: read("read_products"),
  productTags: read("read_products"),
  productTypes: read("read_products"),
  productVendors: read("read_products"),
  productOperation: read("read_products"),
  productDuplicateJob: read("read_products"),
  productSavedSearches: read("read_products"),
  collection: read("read_products"),
  collections: read("read_products"),
  collectionByHandle: read("read_products"),
  collectionByIdentifier: read("read_products"),
  collectionsCount: read("read_products"),
  collectionRulesConditions: read("read_products"),
  collectionSavedSearches: read("read_products"),
  // Inventory
  inventoryItem: read("read_inventory"),
  inventoryItems: read("read_inventory"),
  inventoryLevel: read("read_inventory"),
  inventoryProperties: read("read_inventory"),
  // Locations
  location: read("read_locations"),
  locationByIdentifier: read("read_locations"),
  locations: read("read_locations"),
  locationsCount: read("read_locations"),
  // Files
  files: read("read_files"),
  fileSavedSearches: read("read_files"),
  // Publications (sales channels)
  publication: read("read_publications"),
  publications: read("read_publications"),
  publicationsCount: read("read_publications"),
  publishedProductsCount: read("read_publications"),
  channel: read("read_publications"),
  channelByHandle: read("read_publications"),
  channels: read("read_publications"),
  // Generic lookups: every id they touch must be an allowed type (see ALLOWED_GID_TYPES).
  node: read(null),
  nodes: read(null),
  // Store basics and the agent's own access
  shop: read(null),
  currentAppInstallation: read(null),
  // Bulk operation status
  currentBulkOperation: read(null),
  bulkOperation: read(null),
  bulkOperations: read(null),
};

/** Mutation root fields the agent may call. Anything not listed is refused. */
export const MUTATION_ROOTS: Record<string, RootRule> = {
  // Products
  productCreate: write("write_products"),
  productUpdate: write("write_products"),
  productSet: write("write_products"),
  productDuplicate: write("write_products"),
  productChangeStatus: write("write_products"),
  productDelete: del("write_products"),
  productOptionsCreate: write("write_products"),
  productOptionUpdate: write("write_products"),
  productOptionsReorder: write("write_products"),
  productOptionsDelete: del("write_products"),
  productVariantsBulkCreate: write("write_products"),
  productVariantsBulkUpdate: write("write_products"),
  productVariantsBulkReorder: write("write_products"),
  productVariantsBulkDelete: del("write_products"),
  productCreateMedia: write("write_products"),
  productUpdateMedia: write("write_products"),
  productReorderMedia: write("write_products"),
  productDeleteMedia: del("write_products"),
  productVariantAppendMedia: write("write_products"),
  productVariantDetachMedia: write("write_products"),
  productBundleCreate: write("write_products"),
  productBundleUpdate: write("write_products"),
  productVariantRelationshipBulkUpdate: write("write_products"),
  combinedListingUpdate: write("write_products"),
  tagsAdd: write("write_products"),
  tagsRemove: write("write_products"),
  metafieldsSet: write("write_products"),
  metafieldsDelete: del("write_products"),
  // Collections
  collectionCreate: write("write_products"),
  collectionUpdate: write("write_products"),
  collectionDuplicate: write("write_products"),
  collectionAddProducts: write("write_products"),
  collectionAddProductsV2: write("write_products"),
  collectionRemoveProducts: write("write_products"),
  collectionReorderProducts: write("write_products"),
  collectionDelete: del("write_products"),
  // Inventory
  inventoryItemUpdate: write("write_inventory"),
  inventoryAdjustQuantities: write("write_inventory"),
  inventorySetQuantities: write("write_inventory"),
  inventorySetOnHandQuantities: write("write_inventory"),
  inventoryMoveQuantities: write("write_inventory"),
  inventoryActivate: write("write_inventory"),
  inventoryBulkToggleActivation: write("write_inventory"),
  inventorySetScheduledChanges: write("write_inventory"),
  inventoryDeactivate: del("write_inventory"),
  // Locations
  locationAdd: write("write_locations"),
  locationEdit: write("write_locations"),
  locationActivate: write("write_locations"),
  locationLocalPickupEnable: write("write_locations"),
  locationLocalPickupDisable: write("write_locations"),
  locationDeactivate: del("write_locations"),
  locationDelete: del("write_locations"),
  // Files
  stagedUploadsCreate: write("write_files"),
  fileCreate: write("write_files"),
  fileUpdate: write("write_files"),
  fileAcknowledgeUpdateFailed: write("write_files"),
  fileDelete: del("write_files"),
  // Publications
  publishablePublish: write("write_publications"),
  publishableUnpublish: write("write_publications"),
  publishablePublishToCurrentChannel: write("write_publications"),
  publishableUnpublishToCurrentChannel: write("write_publications"),
  publicationCreate: write("write_publications"),
  publicationUpdate: write("write_publications"),
  publicationDelete: del("write_publications"),
  // Bulk operations: the inner document is checked with these same rules.
  bulkOperationRunQuery: read(null),
  bulkOperationRunMutation: { scope: null, risk: "bulk" },
  bulkOperationCancel: read(null),
};

/**
 * Fields refused anywhere in a document, whatever the root. They lead to data
 * outside the agent's scopes (orders, customers, money, staff, content, …),
 * which a store token with extra permissions could otherwise reach through a
 * nested selection such as `shop { orders }`.
 */
export const FORBIDDEN_FIELDS = new Set([
  "order",
  "orders",
  "ordersCount",
  "draftOrder",
  "draftOrders",
  "customer",
  "customers",
  "customersCount",
  "customerByIdentifier",
  "customerSegmentMembers",
  "segments",
  "abandonedCheckouts",
  "abandonment",
  "giftCard",
  "giftCards",
  "discountNode",
  "discountNodes",
  "codeDiscountNodes",
  "automaticDiscountNodes",
  "priceRules",
  "marketingActivities",
  "marketingEvents",
  "staffMember",
  "staffMembers",
  "fulfillmentOrder",
  "fulfillmentOrders",
  "fulfillments",
  "returns",
  "refunds",
  "transactions",
  "shopifyPaymentsAccount",
  "subscriptionContracts",
  "subscriptionBillingAttempts",
  "companies",
  "companyLocations",
  "metaobjects",
  "metaobject",
  "pages",
  "blogs",
  "articles",
  "themes",
  "translatableResources",
  "webhookSubscriptions",
  "urlRedirects",
  "scriptTags",
  "carrierServices",
  "deliveryProfiles",
  "markets",
  "storefrontAccessTokens",
  "appInstallations",
]);

/** Object types the agent may reference by id (gid://shopify/{Type}/…). */
export const ALLOWED_GID_TYPES = new Set([
  "Product",
  "ProductVariant",
  "ProductOption",
  "ProductOptionValue",
  "ProductImage",
  "ProductTaxonomyNode",
  "TaxonomyCategory",
  "Collection",
  "InventoryItem",
  "InventoryLevel",
  "Location",
  "MediaImage",
  "Video",
  "ExternalVideo",
  "Model3d",
  "GenericFile",
  "Publication",
  "Channel",
  "Metafield",
  "BulkOperation",
  "ProductSetOperation",
  "ProductDuplicateOperation",
  "ProductDeleteOperation",
  "ProductBundleOperation",
  "SavedSearch",
  "Shop",
  "AppInstallation",
]);

/** Human words for a scope, for refusals the merchant can act on. */
export const SCOPE_LABELS: Record<StoreAgentScope, string> = {
  read_products: "read products and collections",
  write_products: "edit products and collections",
  read_inventory: "read inventory",
  write_inventory: "edit inventory",
  read_locations: "read locations",
  write_locations: "edit locations",
  read_files: "read files",
  write_files: "upload and edit files",
  read_publications: "read sales channels",
  write_publications: "publish to sales channels",
};

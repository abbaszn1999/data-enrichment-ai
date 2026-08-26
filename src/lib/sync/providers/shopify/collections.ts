// Shopify collections module — first-class entity in v3.
// Fetch, resolve by name, create manual/smart, assign products.
//
// Verified against:
//   https://shopify.dev/docs/api/admin-graphql/latest/queries/collections
//   https://shopify.dev/docs/api/admin-graphql/latest/mutations/collectionCreate
//   https://shopify.dev/docs/api/admin-graphql/latest/mutations/collectionAddProducts

import type {
  DetectedProduct,
  IntegrationRecord,
  SyncSheet,
  SyncSheetRow,
} from "@/lib/sync/core/types";
import { shopifyGraphQL } from "./graphql-client";
import { buildCollectionsQuery } from "./filter-builder";
import {
  COLLECTION_RULE_COLUMNS,
  COLLECTION_RULE_RELATIONS,
} from "./schema-catalog";

// ─── GraphQL documents ────────────────────────────────────────────────────────

const COLLECTIONS_PAGE_QUERY = /* GraphQL */ `
  query Collections($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      edges {
        cursor
        node {
          id
          title
          handle
          descriptionHtml
          sortOrder
          updatedAt
          image { url altText }
          seo { title description }
          productsCount { count }
          ruleSet {
            appliedDisjunctively
            rules { column relation condition }
          }
          resourcePublications(first: 10) {
            edges { node { publication { name } } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const COLLECTION_CREATE = /* GraphQL */ `
  mutation CollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
        sortOrder
        ruleSet {
          appliedDisjunctively
          rules { column relation condition }
        }
      }
      userErrors { field message }
    }
  }
`;

// Permanent deletion of a collection from the Shopify store.
//   docs: https://shopify.dev/docs/api/admin-graphql/latest/mutations/collectionDelete
const COLLECTION_DELETE = /* GraphQL */ `
  mutation CollectionDelete($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) {
      deletedCollectionId
      userErrors { field message }
    }
  }
`;

// Collections created through the Admin API are not attached to any sales
// channel, so their storefront URL returns 404 until they are published to the
// Online Store publication.
//   docs: https://shopify.dev/docs/api/admin-graphql/latest/mutations/publishablePublish
const PUBLICATIONS_QUERY = /* GraphQL */ `
  query Publications {
    publications(first: 25) {
      edges { node { id name } }
    }
  }
`;

const PUBLISHABLE_PUBLISH = /* GraphQL */ `
  mutation PublishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const COLLECTION_ADD_PRODUCTS = /* GraphQL */ `
  mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection { id productsCount { count } }
      userErrors { field message }
    }
  }
`;

// Removal is asynchronous: the mutation returns a Job, not the updated
// collection. Deprecated alongside collectionAddProducts in favour of the new
// collections model, but still served in 2026-07.
//   docs: https://shopify.dev/docs/api/admin-graphql/latest/mutations/collectionRemoveProducts
const COLLECTION_REMOVE_PRODUCTS = /* GraphQL */ `
  mutation CollectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
    collectionRemoveProducts(id: $id, productIds: $productIds) {
      job { id done }
      userErrors { field message }
    }
  }
`;

// The products connection on Collection takes no `query` argument, so the only
// way to find recently created members is to sort by creation time and walk.
//   docs: https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductCollectionSortKeys
const COLLECTION_PRODUCTS_BY_CREATED = /* GraphQL */ `
  query CollectionProductsByCreated($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      id
      products(first: $first, after: $after, sortKey: CREATED, reverse: true) {
        edges {
          cursor
          node {
            id
            title
            handle
            createdAt
            onlineStoreUrl
            productType
            vendor
            tags
            description
            featuredImage { url }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// `collectionUpdate` covers everything except adding/removing products
// (those go through collectionAddProducts/collectionRemoveProducts). The
// `image` field accepts either `src` (remote URL Shopify will fetch) or a
// staged-upload `id`. We use `src` for the simple "agent pasted an image
// URL" flow which doesn't require write_files staged uploads.
//   docs: https://shopify.dev/docs/api/admin-graphql/latest/mutations/collectionUpdate
const COLLECTION_UPDATE = /* GraphQL */ `
  mutation CollectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        handle
        title
        descriptionHtml
        image { url altText }
        seo { title description }
        updatedAt
      }
      userErrors { field message }
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolvedCollection = {
  id: string;
  title: string;
  handle: string;
};

export type CollectionRule = {
  column: (typeof COLLECTION_RULE_COLUMNS)[number];
  relation: (typeof COLLECTION_RULE_RELATIONS)[number];
  condition: string;
  conditionObjectId?: string;
};

export type CreateCollectionInput = {
  title: string;
  type: "manual" | "smart";
  descriptionHtml?: string;
  productIds?: string[];
  ruleSet?: {
    appliedDisjunctively: boolean;
    rules: CollectionRule[];
  };
};

// ─── Functions ────────────────────────────────────────────────────────────────

// Publication ids are stable per store, so resolving them once per process
// avoids an extra round-trip on every collection we create.
const onlineStorePublicationCache = new Map<string, string | null>();

async function resolveOnlineStorePublicationId(
  integration: IntegrationRecord
): Promise<string | null> {
  const cacheKey = String(integration.base_url ?? integration.integration_name ?? "default");
  const cached = onlineStorePublicationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let publicationId: string | null = null;
  try {
    const res = await shopifyGraphQL<{
      publications: { edges: Array<{ node: { id: string; name: string } }> };
    }>({
      integration,
      query: PUBLICATIONS_QUERY,
      variables: {},
      options: { estimatedCost: 5, tag: "publications" },
    });
    const nodes = (res.data?.publications?.edges ?? []).map((e) => e.node);
    publicationId =
      nodes.find((n) => (n.name ?? "").toLowerCase() === "online store")?.id ?? null;
  } catch {
    // Missing read_publications scope — caller falls back to skipping publish.
    publicationId = null;
  }

  onlineStorePublicationCache.set(cacheKey, publicationId);
  return publicationId;
}

/**
 * Attach a collection to the Online Store sales channel so its storefront URL
 * resolves. Never throws: an unpublished collection is still a usable result,
 * and stores whose token lacks `write_publications` should not fail the push.
 */
export async function publishCollectionToOnlineStore(params: {
  integration: IntegrationRecord;
  collectionId: string;
}): Promise<{ published: boolean; reason?: string }> {
  const publicationId = await resolveOnlineStorePublicationId(params.integration);
  if (!publicationId) {
    return { published: false, reason: "Online Store publication not available" };
  }

  try {
    const res = await shopifyGraphQL<{
      publishablePublish: {
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>({
      integration: params.integration,
      query: PUBLISHABLE_PUBLISH,
      variables: {
        id: params.collectionId,
        input: [{ publicationId }],
      },
      options: { estimatedCost: 10, tag: "publishablePublish" },
    });
    if (res.errors.length > 0) {
      return { published: false, reason: res.errors[0].message };
    }
    const userErrors = res.data?.publishablePublish?.userErrors ?? [];
    if (userErrors.length > 0) {
      return { published: false, reason: userErrors[0].message };
    }
    return { published: true };
  } catch (error) {
    return {
      published: false,
      reason: error instanceof Error ? error.message : "publishablePublish failed",
    };
  }
}

function collectionNodeToRow(node: Record<string, unknown>): SyncSheetRow {
  const ruleSet = node.ruleSet as { appliedDisjunctively?: boolean; rules?: unknown[] } | null;
  const productsCount = node.productsCount as { count?: number } | null;
  const image = node.image as { url?: string; altText?: string } | null;
  const seo = node.seo as { title?: string; description?: string } | null;
  const resPubs = node.resourcePublications as {
    edges?: Array<{ node: { publication: { name?: string } } }>;
  } | null;
  const channels = (resPubs?.edges ?? [])
    .map((e) => e.node?.publication?.name)
    .filter(Boolean)
    .join(", ");
  return {
    id: String(node.id ?? ""),
    title: String(node.title ?? ""),
    handle: String(node.handle ?? ""),
    description: String(node.descriptionHtml ?? ""),
    image: String(image?.url ?? ""),
    image_alt_text: String(image?.altText ?? ""),
    published: channels || "Not published",
    seo_title: String(seo?.title ?? ""),
    seo_description: String(seo?.description ?? ""),
    sort_order: String(node.sortOrder ?? ""),
    products_count: Number(productsCount?.count ?? 0),
    type: ruleSet?.rules && ruleSet.rules.length > 0 ? "smart" : "manual",
    updated_at: String(node.updatedAt ?? ""),
  };
}

/** Fetch collections into a SyncSheet. Supports title search via Shopify query syntax. */
export async function fetchShopifyCollections(params: {
  integration: IntegrationRecord;
  query?: string;
  limit?: number;
}): Promise<SyncSheet> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 250);
  const res = await shopifyGraphQL<{
    collections: {
      edges: Array<{ cursor: string; node: Record<string, unknown> }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>({
    integration: params.integration,
    query: COLLECTIONS_PAGE_QUERY,
    variables: {
      first: limit,
      after: null,
      query: params.query ?? null,
    },
    options: { estimatedCost: 2 + limit, tag: "collectionsPage" },
  });
  if (res.errors.length > 0) throw new Error(`collections query: ${res.errors[0].message}`);

  const edges = res.data?.collections?.edges ?? [];
  const rows = edges.map((e) => collectionNodeToRow(e.node));
  return {
    title: `Collections · ${params.integration.integration_name}`,
    columns: [
      "id",
      "title",
      "handle",
      "description",
      "image",
      "image_alt_text",
      "published",
      "seo_title",
      "seo_description",
      "sort_order",
      "products_count",
      "type",
      "updated_at",
    ],
    rows,
  };
}

/**
 * Fetch every collection in the store by walking the full cursor chain.
 *
 * `fetchShopifyCollections` returns a single page, which silently truncates
 * large catalogs. Anything that reasons about the store as a whole (internal
 * link graph, duplicate detection) needs the complete set or its decisions are
 * made against an arbitrary slice.
 */
export async function fetchAllShopifyCollections(params: {
  integration: IntegrationRecord;
  query?: string;
  /** Safety valve so a pathological catalog can't spin forever. */
  maxCollections?: number;
  pageSize?: number;
}): Promise<SyncSheetRow[]> {
  const pageSize = Math.min(Math.max(params.pageSize ?? 250, 1), 250);
  const maxCollections = params.maxCollections ?? 5000;

  type CollectionsPageData = {
    collections: {
      edges: Array<{ cursor: string; node: Record<string, unknown> }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  const rows: SyncSheetRow[] = [];
  let after: string | null = null;

  while (rows.length < maxCollections) {
    const res: Awaited<ReturnType<typeof shopifyGraphQL<CollectionsPageData>>> =
      await shopifyGraphQL<CollectionsPageData>({
      integration: params.integration,
      query: COLLECTIONS_PAGE_QUERY,
      variables: {
        first: pageSize,
        after,
        query: params.query ?? null,
      },
      options: { estimatedCost: 2 + pageSize, tag: "collectionsPageAll" },
    });
    if (res.errors.length > 0) {
      throw new Error(`collections query: ${res.errors[0].message}`);
    }

    const page = res.data?.collections;
    const edges = page?.edges ?? [];
    for (const edge of edges) {
      rows.push(collectionNodeToRow(edge.node));
    }

    if (!page?.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }

  return rows;
}

/** Resolve a collection by exact/partial title to its GID. Returns first match. */
export async function resolveCollectionByName(params: {
  integration: IntegrationRecord;
  name: string;
}): Promise<ResolvedCollection | null> {
  const searchQuery = buildCollectionsQuery(params.name);
  const res = await shopifyGraphQL<{
    collections: {
      edges: Array<{ node: { id?: string; title?: string; handle?: string } }>;
    };
  }>({
    integration: params.integration,
    query: /* GraphQL */ `
      query ResolveCollection($query: String!) {
        collections(first: 5, query: $query) {
          edges { node { id title handle } }
        }
      }
    `,
    variables: { query: searchQuery },
    options: { estimatedCost: 3, tag: "resolveCollection" },
  });
  if (res.errors.length > 0) throw new Error(`resolveCollection: ${res.errors[0].message}`);

  const edges = res.data?.collections?.edges ?? [];
  const first = edges[0]?.node;
  if (!first?.id) return null;

  // Prefer exact-title match if multiple
  const exact = edges.find(
    (e) => (e.node.title ?? "").toLowerCase() === params.name.toLowerCase()
  );
  const pick = exact?.node ?? first;
  return {
    id: String(pick.id),
    title: String(pick.title ?? ""),
    handle: String(pick.handle ?? ""),
  };
}

/** Create a manual or smart collection. Returns the created collection's GID + handle. */
export async function createShopifyCollection(params: {
  integration: IntegrationRecord;
  input: CreateCollectionInput;
}): Promise<{ id: string; handle: string; title: string; assignedCount?: number }> {
  const { input } = params;

  // CollectionInput no longer accepts a `products` field (removed in Shopify
  // Admin GraphQL 2024-04). For manual collections we create first, then add
  // products via `collectionAddProducts` — which is what this function does
  // below when productIds is supplied.
  const gqlInput: Record<string, unknown> = { title: input.title };
  if (input.descriptionHtml) gqlInput.descriptionHtml = input.descriptionHtml;
  if (input.type === "smart") {
    if (!input.ruleSet || input.ruleSet.rules.length === 0) {
      throw new Error("Smart collection requires a non-empty ruleSet");
    }
    gqlInput.ruleSet = {
      appliedDisjunctively: input.ruleSet.appliedDisjunctively,
      rules: input.ruleSet.rules.map((r) => ({
        column: r.column,
        relation: r.relation,
        condition: r.condition,
        ...(r.conditionObjectId ? { conditionObjectId: r.conditionObjectId } : {}),
      })),
    };
  }

  const res = await shopifyGraphQL<{
    collectionCreate: {
      collection: { id?: string; handle?: string; title?: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>({
    integration: params.integration,
    query: COLLECTION_CREATE,
    variables: { input: gqlInput },
    options: { estimatedCost: 11, tag: "collectionCreate" },
  });
  if (res.errors.length > 0) throw new Error(`collectionCreate: ${res.errors[0].message}`);
  const payload = res.data?.collectionCreate;
  if (!payload) throw new Error("collectionCreate returned no payload");
  if (payload.userErrors.length > 0) {
    const ue = payload.userErrors[0];
    throw new Error(
      `collectionCreate userError: ${ue.message}${
        ue.field && ue.field.length ? ` (field: ${ue.field.join(".")})` : ""
      }`
    );
  }
  const c = payload.collection;
  if (!c?.id) throw new Error("collectionCreate returned no collection id");
  const createdId = String(c.id);

  // Without this the collection exists in the admin but its storefront URL 404s.
  const publishResult = await publishCollectionToOnlineStore({
    integration: params.integration,
    collectionId: createdId,
  });
  if (!publishResult.published) {
    console.warn(
      `[shopify] collection ${createdId} created but not published to Online Store: ${publishResult.reason}`
    );
  }

  // Second step: if the caller requested products in a manual collection,
  // add them now via the dedicated mutation.
  let assignedCount: number | undefined;
  if (input.type === "manual" && input.productIds && input.productIds.length > 0) {
    const { assignedCount: n } = await assignProductsToCollection({
      integration: params.integration,
      collectionId: createdId,
      productIds: input.productIds,
    });
    assignedCount = n;
  }

  return {
    id: createdId,
    handle: String(c.handle ?? ""),
    title: String(c.title ?? input.title),
    assignedCount,
  };
}

/**
 * Permanently delete a Shopify collection by GID. Returns the deleted GID on
 * success. Idempotent in spirit — if Shopify reports the collection no longer
 * exists, we treat that as a successful delete (the end state is the same).
 *
 *   docs: https://shopify.dev/docs/api/admin-graphql/latest/mutations/collectionDelete
 */
export async function deleteShopifyCollection(params: {
  integration: IntegrationRecord;
  collectionId: string;
}): Promise<{ deletedId: string }> {
  const id = params.collectionId;
  if (!id || !id.startsWith("gid://shopify/Collection/")) {
    throw new Error(`Invalid collection GID: "${id}"`);
  }
  const res = await shopifyGraphQL<{
    collectionDelete: {
      deletedCollectionId: string | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>({
    integration: params.integration,
    query: COLLECTION_DELETE,
    variables: { input: { id } },
    options: { estimatedCost: 10, tag: "collectionDelete" },
  });
  if (res.errors.length > 0) throw new Error(`collectionDelete: ${res.errors[0].message}`);
  const payload = res.data?.collectionDelete;
  if (!payload) throw new Error("collectionDelete returned no payload");
  if (payload.userErrors.length > 0) {
    const ue = payload.userErrors[0];
    throw new Error(
      `collectionDelete userError: ${ue.message}${
        ue.field && ue.field.length ? ` (field: ${ue.field.join(".")})` : ""
      }`
    );
  }
  return { deletedId: payload.deletedCollectionId ?? id };
}

/** Add products to a collection (additive — does not remove existing). */
export async function assignProductsToCollection(params: {
  integration: IntegrationRecord;
  collectionId: string;
  productIds: string[];
}): Promise<{ assignedCount: number; newTotal: number | null }> {
  if (params.productIds.length === 0) {
    return { assignedCount: 0, newTotal: null };
  }
  // Shopify input array max = 250
  const chunks: string[][] = [];
  for (let i = 0; i < params.productIds.length; i += 250) {
    chunks.push(params.productIds.slice(i, i + 250));
  }
  let assigned = 0;
  let newTotal: number | null = null;
  for (const chunk of chunks) {
    const res = await shopifyGraphQL<{
      collectionAddProducts: {
        collection: { id: string; productsCount?: { count?: number } } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>({
      integration: params.integration,
      query: COLLECTION_ADD_PRODUCTS,
      variables: { id: params.collectionId, productIds: chunk },
      options: { estimatedCost: 10 + chunk.length * 0.2, tag: "collectionAddProducts" },
    });
    if (res.errors.length > 0) throw new Error(`collectionAddProducts: ${res.errors[0].message}`);
    const payload = res.data?.collectionAddProducts;
    if (!payload) throw new Error("collectionAddProducts returned no payload");
    if (payload.userErrors.length > 0) {
      throw new Error(`collectionAddProducts userError: ${payload.userErrors[0].message}`);
    }
    assigned += chunk.length;
    const count = payload.collection?.productsCount?.count;
    if (typeof count === "number") newTotal = count;
  }
  return { assignedCount: assigned, newTotal };
}

/**
 * Remove products from a manual collection.
 *
 * Shopify performs this in a background job, so a successful return means the
 * removal was accepted rather than completed. The job id is handed back so the
 * caller can say "removing" instead of overstating what it knows.
 */
export async function removeProductsFromCollection(params: {
  integration: IntegrationRecord;
  collectionId: string;
  productIds: string[];
}): Promise<{ removedCount: number; pendingJobRef?: string }> {
  if (params.productIds.length === 0) return { removedCount: 0 };

  let removed = 0;
  let lastJobId: string | undefined;
  for (let i = 0; i < params.productIds.length; i += 250) {
    const chunk = params.productIds.slice(i, i + 250);
    const res = await shopifyGraphQL<{
      collectionRemoveProducts: {
        job: { id?: string; done?: boolean } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>({
      integration: params.integration,
      query: COLLECTION_REMOVE_PRODUCTS,
      variables: { id: params.collectionId, productIds: chunk },
      options: {
        estimatedCost: 10 + chunk.length * 0.2,
        tag: "collectionRemoveProducts",
      },
    });
    if (res.errors.length > 0) {
      throw new Error(`collectionRemoveProducts: ${res.errors[0].message}`);
    }
    const payload = res.data?.collectionRemoveProducts;
    if (!payload) throw new Error("collectionRemoveProducts returned no payload");
    if (payload.userErrors.length > 0) {
      throw new Error(
        `collectionRemoveProducts userError: ${payload.userErrors[0].message}`
      );
    }
    removed += chunk.length;
    // A job that already reports done needs no follow-up.
    if (payload.job?.id && !payload.job.done) lastJobId = String(payload.job.id);
  }
  return { removedCount: removed, pendingJobRef: lastJobId };
}

/**
 * Products created after `since` inside one collection, newest first.
 *
 * `Collection.products` accepts no `query` argument, so there is no
 * server-side date filter to lean on. Sorting by CREATED descending and
 * stopping at the first product older than the watermark makes this one page
 * in the steady state regardless of how large the collection is.
 *
 * Note that CREATED is the product's own creation time, not the moment it was
 * added to the collection: an old product filed into a watched collection
 * today will not surface here.
 */
export async function detectNewCollectionProducts(params: {
  integration: IntegrationRecord;
  collectionId: string;
  since: string | null;
  maxPages?: number;
  pageSize?: number;
}): Promise<{
  products: DetectedProduct[];
  newestCreatedAt: string | null;
  truncated?: boolean;
}> {
  // A null watermark means the rule was just created and is only responsible
  // for what comes next. Walking the catalog here would classify the entire
  // back catalogue on the first tick.
  if (!params.since) return { products: [], newestCreatedAt: null };

  const sinceMs = Date.parse(params.since);
  if (!Number.isFinite(sinceMs)) {
    throw new Error(`Invalid watermark timestamp: "${params.since}"`);
  }

  const pageSize = Math.min(Math.max(params.pageSize ?? 250, 1), 250);
  // Generous on purpose. In the steady state the walk stops at the watermark on
  // the first page; the ceiling only exists so a bulk import cannot turn one
  // detection into an unbounded crawl. Reaching it is reported as truncated
  // rather than treated as "nothing more to see".
  const maxPages = Math.max(params.maxPages ?? 20, 1);

  type Node = {
    id?: string;
    title?: string;
    handle?: string;
    createdAt?: string;
    onlineStoreUrl?: string | null;
    productType?: string | null;
    vendor?: string | null;
    tags?: string[] | null;
    description?: string | null;
    featuredImage?: { url?: string } | null;
  };
  type PageData = {
    collection: {
      products: {
        edges: Array<{ cursor: string; node: Node }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } | null;
  };

  const products: DetectedProduct[] = [];
  let newestCreatedAt: string | null = null;
  let after: string | null = null;
  let reachedWatermark = false;
  let page = 0;

  while (page < maxPages) {
    const res: Awaited<ReturnType<typeof shopifyGraphQL<PageData>>> =
      await shopifyGraphQL<PageData>({
        integration: params.integration,
        query: COLLECTION_PRODUCTS_BY_CREATED,
        variables: { id: params.collectionId, first: pageSize, after },
        options: {
          estimatedCost: 2 + pageSize,
          tag: "collectionProductsByCreated",
        },
      });
    if (res.errors.length > 0) {
      throw new Error(`collection products: ${res.errors[0].message}`);
    }
    const connection = res.data?.collection?.products;
    if (!connection) {
      throw new Error(`Collection not found: ${params.collectionId}`);
    }

    for (const edge of connection.edges) {
      const node = edge.node;
      const createdAt = String(node.createdAt ?? "");
      const createdMs = Date.parse(createdAt);
      if (!Number.isFinite(createdMs) || createdMs <= sinceMs) {
        // Sorted newest first, so everything past this point is older too.
        reachedWatermark = true;
        break;
      }
      if (!node.id) continue;
      if (!newestCreatedAt) newestCreatedAt = createdAt;
      products.push({
        id: String(node.id),
        title: String(node.title ?? ""),
        createdAt,
        url: node.onlineStoreUrl ?? undefined,
        imageUrl: node.featuredImage?.url ?? undefined,
        productType: node.productType ?? undefined,
        vendor: node.vendor ?? undefined,
        tags: node.tags ?? undefined,
        description: node.description ?? undefined,
      });
    }

    page += 1;
    if (reachedWatermark) break;
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }

  return {
    products,
    newestCreatedAt,
    // Only a walk that ran out of pages while still finding new products is
    // truncated; stopping at the watermark is the successful case.
    truncated: !reachedWatermark && page >= maxPages ? true : undefined,
  };
}

// ─── Apply path: push pending sheet edits back to Shopify collections ────────

/**
 * Push edits made on a Collections sheet back to Shopify via collectionUpdate.
 * Only the columns listed in `changedColumns` are sent — handle/id are used as
 * the identifier and never overwrite themselves. Returns per-row outcomes for
 * the agent to surface back to the user.
 *
 * Supported columns: title, description, image, image_alt_text, seo_title,
 * seo_description, sort_order.
 */
export type CollectionUpdateOutcome = {
  ok: boolean;
  id: string;
  handle: string;
  errors: string[];
};

export async function applyShopifyCollectionUpdates(params: {
  integration: IntegrationRecord;
  updates: Array<{ row: SyncSheetRow; changedColumns: string[] | null }>;
}): Promise<{ updatedCount: number; outcomes: CollectionUpdateOutcome[]; errors: string[] }> {
  const outcomes: CollectionUpdateOutcome[] = [];
  const errors: string[] = [];
  let updatedCount = 0;

  for (const { row, changedColumns } of params.updates) {
    const id = String(row.id ?? "").trim();
    const handle = String(row.handle ?? "").trim();
    if (!id || !id.startsWith("gid://shopify/Collection/")) {
      const e = `Skipping row with invalid collection id: "${id}"`;
      errors.push(e);
      outcomes.push({ ok: false, id, handle, errors: [e] });
      continue;
    }

    const touched = (col: string) =>
      !changedColumns || changedColumns.length === 0 || changedColumns.includes(col);

    const input: Record<string, unknown> = { id };
    if (touched("title") && row.title !== undefined) {
      const v = String(row.title ?? "").trim();
      if (v) input.title = v;
    }
    // Description — accept both `description` (canonical for collections)
    // AND `body_html` (the products convention; the agent sometimes writes
    // to this column on collections sheets because it's used to writing
    // descriptions to body_html on products). Prefer `description` if set,
    // fall back to `body_html`. Without this fallback, edits to body_html
    // on a collections sheet are silently dropped — apply takes 1ms and
    // looks "successful" because the input only has `id` and we short-
    // circuit the mutation.
    if (touched("description") || touched("body_html")) {
      const desc =
        row.description !== undefined && String(row.description ?? "") !== ""
          ? String(row.description ?? "")
          : row.body_html !== undefined
            ? String(row.body_html ?? "")
            : undefined;
      if (desc !== undefined) input.descriptionHtml = desc;
    }
    if (touched("sort_order") && row.sort_order !== undefined) {
      const v = String(row.sort_order ?? "").trim();
      if (v) input.sortOrder = v;
    }

    // Image — pass the remote URL via `src`; Shopify fetches it server-side.
    // If the column is touched but empty → explicitly clear the image.
    // IMPORTANT: when only `image_alt_text` changed (not the URL), send just
    // `{ altText }` without `src` so Shopify updates the existing image's alt
    // text without re-fetching the URL (which would fail for hotlink-blocked
    // hosts like freepik, NYT, etc.).
    if (touched("image") || touched("image_alt_text")) {
      const url = String(row.image ?? "").trim();
      const alt = String(row.image_alt_text ?? "").trim();
      const imageUrlChanged = touched("image") && changedColumns && changedColumns.includes("image");
      if (imageUrlChanged && url) {
        // Image URL was explicitly changed — send both src + altText
        input.image = { src: url, ...(alt ? { altText: alt } : {}) };
      } else if (imageUrlChanged && !url) {
        // Image URL cleared → remove the image
        input.image = null;
      } else if (touched("image_alt_text") && alt) {
        // Only alt text changed — update alt without re-sending the URL
        input.image = { altText: alt };
      }
    }

    // SEO — only set the sub-object when at least one SEO field is touched.
    // Both halves are then resent from the row: Shopify nulls out whichever
    // SEOInput field is omitted, so sending just one would wipe the other.
    const seoTouched =
      (touched("seo_title") && row.seo_title !== undefined) ||
      (touched("seo_description") && row.seo_description !== undefined);
    if (seoTouched) {
      const seo: Record<string, unknown> = {};
      if (row.seo_title !== undefined) seo.title = String(row.seo_title ?? "");
      if (row.seo_description !== undefined) {
        seo.description = String(row.seo_description ?? "");
      }
      input.seo = seo;
    }

    // If only `id` ended up in the input there's nothing real to send.
    if (Object.keys(input).length <= 1) {
      outcomes.push({ ok: true, id, handle, errors: [] });
      continue;
    }

    // Log what we're about to send so the failure mode is debuggable when
    // descriptions/images keep "succeeding" but not landing in the admin.
    // eslint-disable-next-line no-console
    console.log("[collectionUpdate] →", {
      handle,
      changedColumns,
      inputKeys: Object.keys(input),
      hasDescription: "descriptionHtml" in input,
      hasImage: "image" in input,
      descriptionPreview:
        typeof input.descriptionHtml === "string"
          ? (input.descriptionHtml as string).slice(0, 80)
          : null,
    });

    try {
      const res = await shopifyGraphQL<{
        collectionUpdate: {
          collection: {
            id?: string;
            handle?: string;
            descriptionHtml?: string | null;
            image?: { url?: string; altText?: string } | null;
          } | null;
          userErrors: Array<{ field: string[] | null; message: string }>;
        };
      }>({
        integration: params.integration,
        query: COLLECTION_UPDATE,
        variables: { input },
        options: { estimatedCost: 10, tag: "collectionUpdate" },
      });

      // eslint-disable-next-line no-console
      console.log("[collectionUpdate] ←", {
        handle,
        topLevelErrors: res.errors.length,
        userErrors: res.data?.collectionUpdate?.userErrors ?? [],
        returnedDescriptionLen:
          (res.data?.collectionUpdate?.collection?.descriptionHtml ?? "").length,
        returnedImageUrl: res.data?.collectionUpdate?.collection?.image?.url ?? null,
      });

      if (res.errors.length > 0) {
        const msgs = res.errors.map((e) => e.message);
        errors.push(`[${handle || id}] ${msgs.join("; ")}`);
        outcomes.push({ ok: false, id, handle, errors: msgs });
        continue;
      }
      const payload = res.data?.collectionUpdate;
      if (!payload) {
        const m = "collectionUpdate returned no payload";
        errors.push(`[${handle || id}] ${m}`);
        outcomes.push({ ok: false, id, handle, errors: [m] });
        continue;
      }
      if (payload.userErrors.length > 0) {
        const msgs = payload.userErrors.map(
          (e) => `${e.field ? e.field.join(".") + ": " : ""}${e.message}`
        );
        errors.push(`[${handle || id}] ${msgs.join("; ")}`);
        outcomes.push({ ok: false, id, handle, errors: msgs });
        continue;
      }

      // Detect the silent-drop case: we asked Shopify to set an image via
      // a remote URL, the mutation returned no userErrors, but the
      // resulting collection.image is null. This means Shopify accepted
      // the request but its server-side fetch of the URL failed (most
      // common cause: the host blocks hotlinking — freepik, NYT,
      // discourse-cdn, etc. — or returns non-image content). The user
      // would otherwise see "1 updated" and assume success while Shopify
      // admin still shows no image. Surface it as a per-row error so the
      // agent's summary makes the failure visible.
      const askedForImage = "image" in input && input.image !== null;
      const gotImageBack = !!payload.collection?.image?.url;
      if (askedForImage && !gotImageBack) {
        const url = (input.image as { src?: string } | null)?.src ?? "";
        const m =
          `Shopify accepted the update but did not save the image. The remote URL is ` +
          `likely blocking hotlink fetches (common with freepik, NYT, discourse-cdn). ` +
          `Try a direct image URL ending in .jpg/.png from a permissive host.` +
          (url ? ` URL: ${url}` : "");
        errors.push(`[${handle || id}] ${m}`);
        outcomes.push({ ok: false, id, handle, errors: [m] });
        continue;
      }

      updatedCount += 1;
      outcomes.push({ ok: true, id, handle, errors: [] });
    } catch (err) {
      const m = (err as Error).message || "collectionUpdate threw";
      errors.push(`[${handle || id}] ${m}`);
      outcomes.push({ ok: false, id, handle, errors: [m] });
    }
  }

  return { updatedCount, outcomes, errors };
}

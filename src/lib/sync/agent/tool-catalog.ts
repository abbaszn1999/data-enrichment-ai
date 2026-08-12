// Tool catalog — typed schemas + metadata for every tool the agent can call.
// Each tool has: name, strategy class, Zod input schema, description (for LLM),
// and response_format hint. Handlers live in ./tool-handlers/*.

import { z } from "zod";
import {
  SERVER_FILTER_KEYS,
  CLIENT_PREDICATE_KINDS,
  COLLECTION_RULE_COLUMNS,
  COLLECTION_RULE_RELATIONS,
} from "@/lib/sync/providers/shopify/schema-catalog";
import {
  getAllWritableColumns,
  getAllColumnProfileKeys,
  getProviderSchema,
  PROVIDERS,
} from "@/lib/sync/core/registry";
import {
  DEFAULT_GALLERY_IMAGE_COUNT,
  MAX_GALLERY_IMAGE_COUNT,
} from "@/lib/sync/core/gallery-images";
import type {
  AgentStrategy,
  ProviderSchema,
  SyncProviderId,
} from "@/lib/sync/core/types";

// Union of writable columns across ALL registered providers. The agent loop's
// per-provider system instruction steers the model to the correct subset for
// the connected platform; this enum only needs to be permissive enough that a
// column valid on the connected provider passes validation. Adding a provider
// automatically widens this set — no edit here required.
const WRITABLE_COLUMNS = getAllWritableColumns() as [string, ...string[]];

// Union of column-profile keys (UI tabs) across ALL registered providers, for
// the same reason as WRITABLE_COLUMNS above. Adding a provider widens this set.
const COLUMN_PROFILE_KEYS = getAllColumnProfileKeys() as [string, ...string[]];

// ─── Reusable sub-schemas ────────────────────────────────────────────────────

const ShopifyServerFilterSchema = z
  .object({
    status: z.enum(["ACTIVE", "ARCHIVED", "DRAFT"]).optional(),
    vendor: z.string().optional(),
    productType: z.string().optional(),
    tag: z.union([z.string(), z.array(z.string())]).optional(),
    collectionId: z.string().optional(),
    priceRange: z
      .object({ min: z.number().optional(), max: z.number().optional() })
      .optional(),
    inventoryRange: z
      .object({ min: z.number().optional(), max: z.number().optional() })
      .optional(),
    outOfStockSomewhere: z.boolean().optional(),
    isPriceReduced: z.boolean().optional(),
    giftCard: z.boolean().optional(),
    createdAfter: z.string().optional(),
    updatedAfter: z.string().optional(),
    handle: z.string().optional(),
    sku: z.string().optional(),
    barcode: z.string().optional(),
    metafield: z
      .object({ namespace: z.string(), key: z.string(), value: z.string() })
      .optional(),
    publishedStatus: z.enum(["published", "unpublished", "any"]).optional(),
    freeText: z.string().optional(),
  })
  .passthrough();

const ClientPredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing_image") }),
  z.object({ kind: z.literal("image_count_lt"), n: z.number().int().min(0) }),
  z.object({
    kind: z.literal("description_shorter_than"),
    chars: z.number().int().min(0),
  }),
  z.object({ kind: z.literal("missing_seo_title") }),
  z.object({ kind: z.literal("missing_seo_description") }),
  z.object({ kind: z.literal("missing_alt_text") }),
  z.object({ kind: z.literal("title_matches"), regex: z.string() }),
  z.object({ kind: z.literal("no_collections") }),
  z.object({ kind: z.literal("body_html_empty") }),
]);

const ColumnProfileKeySchema = z.enum(COLUMN_PROFILE_KEYS);

// ─── Provider-shaped schema factories ────────────────────────────────────────
//
// Three tools carry a provider-specific vocabulary. Building them from a
// factory lets the agent send the connected platform's vocabulary ONLY —
// a WooCommerce-only column never reaches a Shopify session, and Shopify's
// large `serverFilter` object is not shipped to a provider that cannot filter
// server-side. Both correctness and prompt size benefit.

function makeProductsLoadSchema(opts: {
  includeServerFilter: boolean;
  profileKeys: [string, ...string[]];
}) {
  const shape = {
    clientPredicates: z.array(ClientPredicateSchema).optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(250).optional(),
    // Intentionally NO default here — the handler infers the right mode
    // from context (e.g. `bulk_query` whenever clientPredicates are present,
    // because client-side filters can't be expressed to the platform and would
    // otherwise return a tiny page that doesn't reflect the true match set).
    mode: z.enum(["page", "bulk_query", "by_ids"]).optional(),
    ids: z.array(z.string()).optional(),
    columnProfile: z.enum(opts.profileKeys).default("core"),
  };
  return opts.includeServerFilter
    ? z.object({ ...shape, serverFilter: ShopifyServerFilterSchema.optional() }).passthrough()
    : z.object(shape).passthrough();
}

function makeColumnsWriteSchema(writableColumns: [string, ...string[]]) {
  return z
    .object({
      // Strict enum — the model picks the column from the set that is actually
      // writable on the connected platform, so it can neither hallucinate a
      // name nor pick a column belonging to a different CMS.
      targetColumn: z.enum(writableColumns),
      instruction: z.string().min(1),
      overwrite: z.boolean().default(false),
      rowIndexes: z.array(z.number().int().min(0)).optional(),
      // 0 = no cap (process every targeted row). Hard ceiling 2000 prevents
      // an accidental runaway cost. The handler streams partial results so
      // even a 1000-row write feels live in the UI.
      scopeCap: z.number().int().min(0).max(2000).default(0),
    })
    .passthrough();
}

function makeCollectionsCreateSchema(opts: {
  includeSmartRules: boolean;
  includeHierarchy: boolean;
}) {
  const base = {
    title: z.string().min(1),
    type: z.enum(["manual", "smart"] as [string, ...string[]]),
    descriptionHtml: z.string().optional(),
    productIds: z.array(z.string()).optional(),
  };
  // Smart rule sets are Shopify-only; slug/parent/imageId are WooCommerce-only.
  const smart = opts.includeSmartRules
    ? {
        ruleSet: z
          .object({
            appliedDisjunctively: z.boolean().default(false),
            rules: z
              .array(
                z.object({
                  column: z.enum(COLLECTION_RULE_COLUMNS),
                  relation: z.enum(COLLECTION_RULE_RELATIONS),
                  condition: z.string(),
                  conditionObjectId: z.string().optional(),
                })
              )
              .min(1),
          })
          .optional(),
      }
    : {};
  const hierarchy = opts.includeHierarchy
    ? {
        slug: z.string().optional(),
        parent: z.number().int().min(0).optional(),
        imageId: z.number().int().min(1).optional(),
      }
    : {};
  return z.object({ ...base, ...smart, ...hierarchy }).passthrough();
}

// ─── Individual tool schemas ─────────────────────────────────────────────────
//
// This map is the permissive UNION across every registered provider. It defines
// `ToolName` and backs any caller that has no integration in hand. The agent
// loop uses `buildToolSchemasForProvider` instead, which narrows the three
// provider-shaped tools above to the connected platform.

export const ToolSchemas = {
  sync_products_load: makeProductsLoadSchema({
    includeServerFilter: true,
    profileKeys: COLUMN_PROFILE_KEYS,
  }),

  sync_products_filter_client: z
    .object({
      predicates: z.array(ClientPredicateSchema).min(1),
      rowIndexes: z.array(z.number().int().min(0)).optional(),
    })
    .passthrough(),

  sync_collections_load: z
    .object({
      query: z.string().optional(),
      limit: z.number().int().min(1).max(250).default(50),
    })
    .passthrough(),

  sync_collections_resolve: z
    .object({
      name: z.string().min(1),
    })
    .passthrough(),

  sync_collections_create: makeCollectionsCreateSchema({
    includeSmartRules: true,
    includeHierarchy: true,
  }),

  sync_collections_assign: z
    .object({
      collectionId: z.string().min(1),
      rowIndexes: z.array(z.number().int().min(0)).min(1),
    })
    .passthrough(),

  sync_collections_delete: z
    .object({
      // Either: a list of collection GIDs to delete directly (when the model
      // already has them from a recent load/resolve), OR a list of row
      // indexes into the current collections sheet whose `id` column holds
      // the GIDs. At least one must be non-empty.
      collectionIds: z.array(z.string().min(1)).optional(),
      rowIndexes: z.array(z.number().int().min(0)).optional(),
    })
    .passthrough(),

  sync_columns_write_with_ai: makeColumnsWriteSchema(WRITABLE_COLUMNS),

  sync_images_search: z
    .object({
      targetColumn: z.string().default("featured_image"),
      instruction: z.string().min(1),
      overwrite: z.boolean().default(false),
      rowIndexes: z.array(z.number().int().min(0)).optional(),
      // Same scopeCap policy as sync_columns_write_with_ai — image search is
      // streamed in waves of 5, so processing the whole catalog is fine.
      scopeCap: z.number().int().min(0).max(2000).default(0),
      // Gallery only. 0 = the user named no number, so the runtime picks the
      // default. The real ceiling is enforced server-side, not by this max.
      imageCount: z
        .number()
        .int()
        .min(0)
        .max(MAX_GALLERY_IMAGE_COUNT)
        .default(0),
    })
    .passthrough(),

  sync_catalog_lookup: z
    .object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    })
    .passthrough(),

  sync_row_append: z
    .object({
      instruction: z.string().min(1),
    })
    .passthrough(),

  sync_sheet_program: z
    .object({
      instruction: z.string().min(1),
      goal: z.enum(["answer", "show_filtered", "target_rows"]),
    })
    .passthrough(),

  sync_answer_question: z
    .object({
      instruction: z.string().min(1),
    })
    .passthrough(),

  sync_research_web: z
    .object({
      instruction: z.string().min(1),
    })
    .passthrough(),

  sync_attachments_analyze: z
    .object({
      instruction: z.string().min(1),
    })
    .passthrough(),

  sync_column_delete: z
    .object({
      column: z.string().min(1),
    })
    .passthrough(),

  sync_apply_to_shopify: z.object({}).passthrough(),

  sync_reply_only: z
    .object({
      message: z.string().min(1),
    })
    .passthrough(),
} as const;

export type ToolName = keyof typeof ToolSchemas;

// ─── Metadata (for planner system prompt + UI labels) ────────────────────────

export type ToolMetadata = {
  name: ToolName;
  strategy: AgentStrategy;
  description: string;
  destructive: boolean;
};

export const TOOL_METADATA: Record<ToolName, ToolMetadata> = {
  sync_products_load: {
    name: "sync_products_load",
    strategy: "read",
    description:
      "Load products from Shopify into the sheet. Use `serverFilter` for API-level filtering (status, vendor, product_type, tag, collection_id, price range, inventory, metafields, dates). Use `clientPredicates` for things Shopify cannot filter server-side (missing_image, no_collections, empty seo, etc.). Use mode='bulk_query' when >250 rows expected. Always pick a `columnProfile`.",
    destructive: false,
  },
  sync_products_filter_client: {
    name: "sync_products_filter_client",
    strategy: "read",
    description:
      "Apply client-side predicates to the currently loaded sheet (e.g., narrow to rows missing images). Returns row indexes matching the predicates.",
    destructive: false,
  },
  sync_collections_load: {
    name: "sync_collections_load",
    strategy: "read",
    description: "Load Shopify collections as a separate sheet.",
    destructive: false,
  },
  sync_collections_resolve: {
    name: "sync_collections_resolve",
    strategy: "read",
    description:
      "Resolve a collection by title to its Shopify GID. Use before any tool that needs a collection_id.",
    destructive: false,
  },
  sync_collections_create: {
    name: "sync_collections_create",
    strategy: "medium_write",
    description:
      "Create a taxonomy group on the connected platform. For Shopify this creates a collection. For WooCommerce this creates a product category with title as name; optional slug, parent, descriptionHtml, and imageId are supported.",
    destructive: false,
  },
  sync_collections_assign: {
    name: "sync_collections_assign",
    strategy: "medium_write",
    description:
      "Assign the given rows (products) to a taxonomy group on the connected platform. For Shopify this adds products to a collection; for WooCommerce it appends the product category (existing categories are preserved). Pass the taxonomy group id as `collectionId` and the product `rowIndexes`.",
    destructive: false,
  },
  sync_collections_delete: {
    name: "sync_collections_delete",
    strategy: "delete",
    description:
      "PERMANENTLY DELETE one or more taxonomy groups from the connected platform (Shopify collections via collectionDelete; WooCommerce product categories via DELETE force=true). Use this ONLY when the user explicitly asks to delete/remove/erase a collection/category (Arabic: حذف/امسح/ازل). DO NOT use this for filter/hide/view-only requests — use sync_products_filter_client or sync_sheet_program for those. Accepts either `collectionIds` (Shopify GIDs or WooCommerce numeric IDs) or `rowIndexes` into the current taxonomy sheet. The deleted rows are removed from the sheet automatically.",
    destructive: true,
  },
  sync_columns_write_with_ai: {
    name: "sync_columns_write_with_ai",
    strategy: "heavy_ai_write",
    description:
      `Fill or rewrite ONE column of the current sheet using AI. Pick \`targetColumn\` from the allowed enum: ${WRITABLE_COLUMNS.join(", ")}. Use \`body_html\` for product descriptions, \`description\` for collection descriptions, \`featured_image_alt_text\` for product image alt text, \`image_alt_text\` for collection image alt text, \`seo_title\`/\`seo_description\` for SEO, \`tags\` for tag lists, \`title\` for titles, etc. Never write \`handle\` (URL slug) — it is protected. Pass the user's intent verbatim as \`instruction\`. For a user-named product, call sync_catalog_lookup first and pass its rowIndexes — never invent indexes from productDirectory alone. Otherwise omit rowIndexes to fall back to remembered targets and scopeCap. Set \`overwrite=true\` only if the user explicitly asked to replace existing values.`,
    destructive: false,
  },
  sync_images_search: {
    name: "sync_images_search",
    strategy: "heavy_ai_write",
    description:
      `Source product images from the web and write them into an image column of the sheet. Always available (does not require Web mode / Globe). Use this whenever the user wants images found, fetched, added, attached, populated, downloaded, set, or otherwise sourced for one or more products — in any language. Pass the user's intent verbatim as \`instruction\`. CRITICAL: for a user-named product you MUST call sync_catalog_lookup first, then pass ONLY the returned rowIndexes — never omit rowIndexes after loading the whole catalog, never pass every row index, and never use productDirectory indexes alone. Set \`targetColumn\` to 'featured_image' (default) for the ONE main image, or 'gallery_images' when the user wants a gallery / extra / additional images / more than one photo (صور إضافية، معرض صور، أكثر من صورة). For 'gallery_images' set \`imageCount\` to the number the user asked for (max ${MAX_GALLERY_IMAGE_COUNT}); leave it at 0 when they named no number and the runtime uses ${DEFAULT_GALLERY_IMAGE_COUNT}. Gallery images are appended to whatever the product already has unless overwrite=true.`,
    destructive: false,
  },
  sync_catalog_lookup: {
    name: "sync_catalog_lookup",
    strategy: "read",
    description:
      "Look up products in the currently loaded sheet by name/handle/id (deterministic full-sheet search). REQUIRED before image or column writes that target a user-named product — even if the title appears in productDirectory. Returns matches with rowIndex. If count>1, ask the user which product; if count===0, say not found. Do not invent indexes.",
    destructive: false,
  },
  sync_row_append: {
    name: "sync_row_append",
    strategy: "medium_write",
    description: "Append a new row to the sheet based on an instruction.",
    destructive: false,
  },
  sync_sheet_program: {
    name: "sync_sheet_program",
    strategy: "read",
    description:
      "Run a structured filter/sort/count program over the currently loaded sheet. goal='answer' for a summary, 'show_filtered' to narrow the view, 'target_rows' to select rows for a follow-up edit.",
    destructive: false,
  },
  sync_answer_question: {
    name: "sync_answer_question",
    strategy: "read",
    description: "Answer an analytical question about the current sheet.",
    destructive: false,
  },
  sync_research_web: {
    name: "sync_research_web",
    strategy: "read",
    description:
      "Search the web for grounded text research (product facts, specs, sources). Only available when Web mode (Globe) is enabled. Image search uses sync_images_search separately and does not need Web mode.",
    destructive: false,
  },
  sync_attachments_analyze: {
    name: "sync_attachments_analyze",
    strategy: "read",
    description: "Analyze uploaded images or PDFs. Only when attachments are present.",
    destructive: false,
  },
  sync_column_delete: {
    name: "sync_column_delete",
    strategy: "delete",
    description: "Delete a column from the sheet.",
    destructive: true,
  },
  sync_apply_to_shopify: {
    name: "sync_apply_to_shopify",
    strategy: "apply_to_shopify",
    description:
      "Push pending sheet changes back to the connected platform. Shopify uses productSet/bulk operations; WooCommerce uses REST batch product/variation updates.",
    destructive: true,
  },
  sync_reply_only: {
    name: "sync_reply_only",
    strategy: "reply",
    description:
      "Reply with text only — NO sheet/store changes. Use this strictly for: (a) clarifying questions when the request is genuinely ambiguous and you cannot proceed, or (b) pure conversational answers where there is nothing to execute. NEVER use this to acknowledge an actionable request (\"I will fetch images\", \"I'll update the descriptions\", etc.) — if the user asked for an action and a tool exists for it, emit that tool instead.",
    destructive: false,
  },
};

// ─── Provider-scoped catalog ─────────────────────────────────────────────────
//
// Everything the agent sends to the model is derived from the CONNECTED
// integration: which tools exist, what their arguments accept, and how they are
// described. A Shopify session never sees WooCommerce columns and vice versa.

export type ProviderToolContext = {
  providerId: SyncProviderId | null;
  /** Display name of the platform ("Shopify" | "WooCommerce"). */
  providerLabel: string;
  /** What this platform calls taxonomy groups ("Collections" | "Categories"). */
  taxonomyLabel: string;
  schema: ProviderSchema;
  /** Provider implements resolve/assign/delete for taxonomy groups. */
  supportsTaxonomyWrites: boolean;
  /** Provider supports rule-based ("smart") taxonomy groups. Shopify only. */
  supportsSmartTaxonomy: boolean;
  /** Provider taxonomy groups are hierarchical with slug/parent/image. Woo only. */
  supportsTaxonomyHierarchy: boolean;
};

export function buildProviderToolContext(
  providerId: SyncProviderId | null | undefined
): ProviderToolContext {
  const id = providerId && PROVIDERS[providerId] ? providerId : null;
  const provider = id ? PROVIDERS[id] : null;
  const schema = getProviderSchema(id);
  return {
    providerId: id,
    providerLabel: provider?.label ?? "the connected platform",
    taxonomyLabel: schema.taxonomyLabel,
    schema,
    supportsTaxonomyWrites: !!provider?.taxonomy,
    supportsSmartTaxonomy: id === "shopify",
    supportsTaxonomyHierarchy: id === "woocommerce",
  };
}

/** Tools the connected provider can actually service, in catalog order. */
export function listToolsForProvider(ctx: ProviderToolContext): ToolName[] {
  const taxonomyWriteTools = new Set<ToolName>([
    "sync_collections_resolve",
    "sync_collections_assign",
    "sync_collections_delete",
  ]);
  return (Object.keys(ToolSchemas) as ToolName[]).filter((name) => {
    if (taxonomyWriteTools.has(name) && !ctx.supportsTaxonomyWrites) return false;
    return true;
  });
}

/**
 * Argument schemas narrowed to the connected provider. Used for BOTH the
 * function declarations sent to the model and the runtime validation of the
 * arguments it returns, so the two can never disagree.
 */
export function buildToolSchemasForProvider(
  ctx: ProviderToolContext
): Record<ToolName, z.ZodType> {
  const writable = [...ctx.schema.writableColumns] as [string, ...string[]];
  const profiles = Object.keys(ctx.schema.columnProfiles) as [string, ...string[]];
  return {
    ...(ToolSchemas as unknown as Record<ToolName, z.ZodType>),
    sync_products_load: makeProductsLoadSchema({
      includeServerFilter: ctx.schema.serverFilterKeys.length > 0,
      profileKeys: profiles.length > 0 ? profiles : COLUMN_PROFILE_KEYS,
    }),
    sync_columns_write_with_ai: makeColumnsWriteSchema(
      writable.length > 0 ? writable : WRITABLE_COLUMNS
    ),
    sync_collections_create: makeCollectionsCreateSchema({
      includeSmartRules: ctx.supportsSmartTaxonomy,
      includeHierarchy: ctx.supportsTaxonomyHierarchy,
    }),
  };
}

/** Tool description phrased for the connected provider's vocabulary. */
export function describeToolForProvider(
  name: ToolName,
  ctx: ProviderToolContext
): string {
  const platform = ctx.providerLabel;
  const taxonomy = ctx.taxonomyLabel;
  const writable = ctx.schema.writableColumns.join(", ");
  const predicates = ctx.schema.clientPredicateKinds.join(", ");
  const canFilterServerSide = ctx.schema.serverFilterKeys.length > 0;

  switch (name) {
    case "sync_products_load":
      return (
        `Load products from ${platform} into the sheet. ` +
        (canFilterServerSide
          ? "Use `serverFilter` for API-level filtering (status, vendor, product_type, tag, collection_id, price range, inventory, metafields, dates). "
          : `${platform} cannot filter server-side — there is no serverFilter argument. Load, then narrow with clientPredicates. `) +
        `Use \`clientPredicates\` for post-fetch filtering (${predicates}). ` +
        "Use mode='bulk_query' when >250 rows expected. Always pick a `columnProfile`."
      );
    case "sync_collections_load":
      return `Load ${platform} ${taxonomy} as a separate sheet.`;
    case "sync_collections_resolve":
      return `Resolve one of the store's ${taxonomy} by title to its ${platform} id. Use before any tool that needs a collectionId.`;
    case "sync_collections_create":
      return (
        `Create a new taxonomy group (${taxonomy}) on ${platform}. ` +
        (ctx.supportsSmartTaxonomy
          ? "Pass type='smart' with a `ruleSet` for a rule-based group, or type='manual' with optional productIds. "
          : "Pass type='manual'; rule-based groups are not supported on this platform. ") +
        (ctx.supportsTaxonomyHierarchy
          ? "Optional `slug`, `parent` (for nesting) and `imageId` are supported."
          : "")
      ).trim();
    case "sync_collections_assign":
      return `Add the given product \`rowIndexes\` to one of the store's ${taxonomy} on ${platform} (additive — existing memberships are preserved). Pass the group id as \`collectionId\`.`;
    case "sync_collections_delete":
      return `PERMANENTLY DELETE one or more ${taxonomy} from ${platform}. Use ONLY when the user explicitly asks to delete/remove/erase (Arabic: حذف/امسح/ازل). DO NOT use for filter/hide/view-only requests — use sync_products_filter_client or sync_sheet_program for those. Accepts \`collectionIds\` or \`rowIndexes\` into the current taxonomy sheet. Deleted rows are removed from the sheet automatically.`;
    case "sync_columns_write_with_ai":
      return `Fill or rewrite ONE column of the current sheet using AI. \`targetColumn\` must be one of the columns writable on ${platform}: ${writable}. Use \`body_html\` for product descriptions, \`featured_image_alt_text\` for image alt text, \`seo_title\`/\`seo_description\` for SEO, \`tags\` for tag lists, \`title\` for titles. Never write \`handle\` (URL slug) — it is protected; for SEO goals use seo_title/seo_description instead. Pass the user's intent verbatim as \`instruction\`. For a user-named product, call sync_catalog_lookup first and pass its rowIndexes — never invent indexes from productDirectory alone. Otherwise omit rowIndexes to fall back to remembered targets and scopeCap. Set \`overwrite=true\` only if the user explicitly asked to replace existing values.`;
    case "sync_apply_to_shopify":
      return `Push the sheet's pending changes back to ${platform}. Requires user confirmation.`;
    default:
      return TOOL_METADATA[name].description;
  }
}

export function isValidTool(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(ToolSchemas, name);
}

export function validateToolArgs(
  name: ToolName,
  args: unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  const schema = ToolSchemas[name];
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}

// ─── Planner prompt block (so LLM sees valid filter keys + predicates) ───────

export function buildToolSystemBlock(options: {
  webEnabled: boolean;
  hasAttachments: boolean;
}): string {
  // Globe / webEnabled gates text research only — never sync_images_search.
  const unavailable: string[] = [];
  if (!options.webEnabled) unavailable.push("sync_research_web");
  if (!options.hasAttachments) unavailable.push("sync_attachments_analyze");

  const toolList = Object.values(TOOL_METADATA)
    .map((m) => `- ${m.name} [${m.strategy}]: ${m.description}`)
    .join("\n");

  return `Available tools:
${toolList}
${unavailable.length > 0 ? `\nUnavailable this turn: ${unavailable.join(", ")}` : ""}

Shopify server-side filter keys you MAY use in serverFilter (nothing else):
${SERVER_FILTER_KEYS.join(", ")}

Client-side predicates (applied after fetch — use for things Shopify cannot filter):
${CLIENT_PREDICATE_KINDS.join(", ")}

Column profiles you MUST pick from:
${COLUMN_PROFILE_KEYS.join(", ")}`;
}

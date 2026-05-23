// Tool catalog — typed schemas + metadata for every tool the agent can call.
// Each tool has: name, strategy class, Zod input schema, description (for LLM),
// and response_format hint. Handlers live in ./tool-handlers/*.

import { z } from "zod";
import {
  SERVER_FILTER_KEYS,
  CLIENT_PREDICATE_KINDS,
  COLUMN_PROFILES,
  COLLECTION_RULE_COLUMNS,
  COLLECTION_RULE_RELATIONS,
  WRITABLE_COLUMNS,
} from "@/lib/sync/providers/shopify/schema-catalog";
import type { AgentStrategy } from "@/lib/sync/core/types";

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

const ColumnProfileKeySchema = z.enum(
  Object.keys(COLUMN_PROFILES) as [string, ...string[]]
);

// ─── Individual tool schemas ─────────────────────────────────────────────────

export const ToolSchemas = {
  sync_products_load: z
    .object({
      serverFilter: ShopifyServerFilterSchema.optional(),
      clientPredicates: z.array(ClientPredicateSchema).optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(250).optional(),
      // Intentionally NO default here — the handler infers the right mode
      // from context (e.g. `bulk_query` whenever clientPredicates are present,
      // because client-side filters can't be expressed to Shopify and would
      // otherwise return a tiny page that doesn't reflect the true match set).
      mode: z.enum(["page", "bulk_query", "by_ids"]).optional(),
      ids: z.array(z.string()).optional(),
      columnProfile: ColumnProfileKeySchema.default("core"),
    })
    .passthrough(),

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

  sync_collections_create: z
    .object({
      title: z.string().min(1),
      type: z.enum(["manual", "smart"]),
      descriptionHtml: z.string().optional(),
      slug: z.string().optional(),
      parent: z.number().int().min(0).optional(),
      imageId: z.number().int().min(1).optional(),
      productIds: z.array(z.string()).optional(),
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
    })
    .passthrough(),

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

  sync_columns_write_with_ai: z
    .object({
      // Strict enum — the model picks the column from a known set so it can't
      // hallucinate a name. To allow a new column the agent can write, add it
      // to WRITABLE_COLUMNS in schema-catalog.ts.
      targetColumn: z.enum(WRITABLE_COLUMNS),
      instruction: z.string().min(1),
      overwrite: z.boolean().default(false),
      rowIndexes: z.array(z.number().int().min(0)).optional(),
      // 0 = no cap (process every targeted row). Hard ceiling 2000 prevents
      // an accidental runaway cost. The handler streams partial results so
      // even a 1000-row write feels live in the UI.
      scopeCap: z.number().int().min(0).max(2000).default(0),
    })
    .passthrough(),

  sync_images_search: z
    .object({
      targetColumn: z.string().default("featured_image"),
      instruction: z.string().min(1),
      overwrite: z.boolean().default(false),
      rowIndexes: z.array(z.number().int().min(0)).optional(),
      // Same scopeCap policy as sync_columns_write_with_ai — image search is
      // streamed in waves of 5, so processing the whole catalog is fine.
      scopeCap: z.number().int().min(0).max(2000).default(0),
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
      "Assign the given rows (products) to a collection. Uses productSet collections field.",
    destructive: false,
  },
  sync_collections_delete: {
    name: "sync_collections_delete",
    strategy: "delete",
    description:
      "PERMANENTLY DELETE one or more Shopify collections from the store via collectionDelete mutation. Use this ONLY when the user explicitly asks to delete/remove/erase a collection (Arabic: حذف/امسح/ازل). DO NOT use this for filter/hide/view-only requests — use sync_products_filter_client or sync_sheet_program for those. Accepts either `collectionIds` (GIDs) or `rowIndexes` into the current collections sheet. The deleted rows are removed from the sheet automatically.",
    destructive: true,
  },
  sync_columns_write_with_ai: {
    name: "sync_columns_write_with_ai",
    strategy: "heavy_ai_write",
    description:
      `Fill or rewrite ONE column of the current sheet using AI. Pick \`targetColumn\` from the allowed enum: ${WRITABLE_COLUMNS.join(", ")}. Use \`body_html\` for product descriptions, \`description\` for collection descriptions, \`featured_image_alt_text\` for product image alt text, \`image_alt_text\` for collection image alt text, \`seo_title\`/\`seo_description\` for SEO, \`handle\` for URL slugs, \`tags\` for tag lists, \`title\` for titles, etc. Pass the user's intent verbatim as \`instruction\`. Set \`rowIndexes\` to the rows to process; if the user referenced specific rows by position/name use concrete indexes; otherwise omit and the runtime will fall back to remembered targets and scopeCap. Set \`overwrite=true\` only if the user explicitly asked to replace existing values.`,
    destructive: false,
  },
  sync_images_search: {
    name: "sync_images_search",
    strategy: "heavy_ai_write",
    description:
      "Source product images from the web and write them into an image column of the sheet. Use this whenever the user wants images found, fetched, added, attached, populated, downloaded, set, or otherwise sourced for one or more products — in any language. Pass the user's intent verbatim as `instruction`. Set `rowIndexes` to the targeted rows (infer from the user's reference to position, count, or specific products). Default `targetColumn` is 'featured_image'.",
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
      "Search the web for grounded information. Only available when Web mode is enabled.",
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
      "Push pending sheet changes back to Shopify via productSet mutation (bulk when >25 changes).",
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
${Object.keys(COLUMN_PROFILES).join(", ")}`;
}

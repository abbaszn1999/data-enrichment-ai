import { z } from "zod";
import { NextResponse } from "next/server";
import { requireGalleryAuth } from "@/lib/gallery/auth";

export const workspaceIdSchema = z.string().uuid();
export const projectIdSchema = z.string().uuid();

export const seedInputSchema = z.object({
  id: z.string().min(1).max(120),
  term: z.string().min(1).max(200),
});

export const probeBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  market: z.string().min(2).max(16),
  seeds: z.array(seedInputSchema).min(1).max(100),
  attemptId: z.string().uuid(),
});

export const extractStartBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  market: z.string().min(2).max(16),
  seeds: z
    .array(
      seedInputSchema.extend({
        rawKeywordEstimate: z.number().int().nonnegative().max(1_000_000),
      })
    )
    .min(1)
    .max(100),
});

export const extractPollBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  extractId: z.string().uuid(),
  cursors: z
    .array(
      z.object({
        seedId: z.string().min(1).max(120),
        cursor: z.string().max(32).optional(),
        status: z.enum(["running", "succeeded", "failed", "aborted"]).optional(),
      })
    )
    .max(100)
    .optional(),
});

export const extractCancelBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  extractId: z.string().uuid(),
});

export const extractDownloadQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  /** Omit to export every extract archived for the project. */
  extractId: z.string().uuid().optional(),
});

export const pushBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  collectionIds: z.array(z.string().min(1).max(120)).min(1).max(200),
});

export const agentAnalyzeBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
});

export const agentChatBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  stage: z.number().int().min(1).max(7).default(1),
  market: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string().max(4000),
    })
  ).max(50),
  userMessage: z.string().min(1).max(2000),
  currentNiches: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        summary: z.string(),
      })
    )
    .optional(),
  selectedCollectionIds: z.array(z.string()).optional(),
  seedRows: z
    .array(
      z.object({
        id: z.string(),
        collectionId: z.string(),
        broadSeedVariation: z.string(),
        canonicalNicheSeed: z.string(),
        selectedCollection: z.string(),
        broadParentNiche: z.string(),
        productCount: z.number(),
        variationType: z.string(),
        scopeMatch: z.string(),
      })
    )
    .optional(),
  probes: z
    .record(
      z.string(),
      z.object({
        volume: z.string().optional(),
        rawKeywordCount: z.number().optional(),
        cpc: z.string().optional(),
        failed: z.boolean().optional(),
      })
    )
    .optional(),
});

const productFetchCursorSchema = z.object({
  collectionIndex: z.number().int().nonnegative(),
  shopifyAfter: z.string().nullable(),
  wooPage: z.number().int().positive(),
  totalFetched: z.number().int().nonnegative(),
  perCollectionFetched: z.record(z.string(), z.number()),
  done: z.boolean(),
});

// Drives the resumable, paginated product fetch (Tab 2 -> Tab 3 transition).
// One call pages through selected collections for up to ~40s server-side;
// the client loops, feeding back the returned `cursor`, until `done`.
export const productsFetchBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  selectedCollections: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        productCount: z.number().int().nonnegative().optional(),
        parentNicheName: z.string().optional(),
      })
    )
    .min(1)
    .max(100),
  /** Omit or null to start a fresh fetch from the first selected collection. */
  cursor: productFetchCursorSchema.nullable().optional(),
});

// Embeds products already fetched for the given collections (Tab 3 -> 4
// loading). Cursor job: one call embeds one page, client loops on `offset`.
export const embeddingsProductsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  collectionIds: z.array(z.string().min(1)).min(1).max(500),
  offset: z.number().int().nonnegative(),
});

// Embeds surviving category terms with their PLP context (Tab 4 -> 5
// loading). Cursor job over the classified archive.
export const embeddingsTermsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  offset: z.number().int().nonnegative(),
});

export const agentSeedsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  selectedCollections: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        productCount: z.number().int().nonnegative(),
        parentNicheName: z.string(),
        /**
         * True when every PLP under this PLP's parent niche was selected in
         * Stage 2 (the whole niche was picked as a unit), false when only
         * specific PLPs within a bigger niche were chosen. Lets Stage 3
         * decide whether a niche-level canonical seed is appropriate.
         */
        nicheFullySelected: z.boolean().optional(),
      })
    )
    .min(1)
    .max(100),
});

// Stage 4 classifies each term purely on its own wording — no store name, no
// niche/collection list, no volume/difficulty/intent signal. Those fields
// already live on the keyword row from extraction and are never touched by
// classification, so they are intentionally not part of this request body.
//
// The route now runs exclusively as a cursor job over the full extract
// archive (not a client-passed keyword list): 20k+ extracted keywords never
// fit in one request body or one `maxDuration = 60` call, so the client
// loops on `offset` until `done`, same pattern as the Apify extract poll.
export const agentIntentBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  mode: z.literal("archive"),
  offset: z.number().int().nonnegative(),
});

// Stage 5 Phase 2 (Gemini exclusion) is likewise a cursor job over the full
// classified/embedded archive — a store with thousands of surviving
// category terms is thousands of candidate collections, far past one
// request or one route call.
export const agentClusterBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  mode: z.literal("archive"),
  offset: z.number().int().nonnegative(),
});

// Stage 6 on-page copywriting is a cursor job over the project's pushed
// collections: the client sends only the ids it wants generated (up to
// 20k), and the route resolves them against the canonical "collections"
// slice server-side, so it always sees the real storeHandle the push step
// persisted rather than trusting whatever the client happened to have in
// memory. `offset` drives the resumable page loop, same as Stage 4/5.
export const agentOnPageBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  parentNiches: z.array(z.string()).optional(),
  customInstructions: z
    .object({
      seoTitle: z.string().optional(),
      seoDescription: z.string().optional(),
      collectionDescription: z.string().optional(),
      faq: z.string().optional(),
    })
    .optional(),
  collectionIds: z.array(z.string().min(1)).min(1).max(20000),
  offset: z.number().int().nonnegative().default(0),
});

const proposedCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  headKeyword: z.string().optional(),
  parentNiche: z.string().optional(),
  volume: z.number().optional(),
  productCount: z.number().optional(),
  storeHandle: z.string().optional(),
});

// Internal link graph build is likewise a cursor job — 10k pushed
// collections is thousands of Gemini judgement batches, far past one
// request. The route loads the full collection list from storage for the
// registry, then only runs retrieval/judgement for this page's ids.
export const agentInternalLinksBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  collectionIds: z.array(z.string().min(1)).min(1).max(20000),
  offset: z.number().int().nonnegative().default(0),
});

export const agentStrategyBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  parentNiches: z.array(z.string()).optional(),
  collections: z.array(proposedCollectionSchema).max(500).optional(),
  keywords: z
    .array(
      z.object({
        id: z.string(),
        keyword: z.string().min(1),
        sheet: z.string().optional(),
        volume: z.number().optional(),
        difficulty: z.number().optional(),
        /** Needed so the article quota can be dealt across seeds, not by volume alone. */
        seedId: z.string().optional(),
        seed: z.string().optional(),
      })
    )
    .min(1)
    .max(5000),
});

const articleLinkSchema = z.object({
  anchor: z.string(),
  url: z.string(),
  collectionName: z.string(),
});

const articleSkuLinkSchema = z.object({
  anchor: z.string(),
  url: z.string(),
  productName: z.string(),
});

export const agentArticleBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  article: z.object({
    id: z.string(),
    title: z.string().min(1),
    keyword: z.string().min(1),
    type: z.enum(["guide", "comparison", "faq", "roundup"]),
    volume: z.number().optional(),
    difficulty: z.number().optional(),
    linksOut: z.array(articleLinkSchema).max(12).optional(),
    skuLinks: z.array(articleSkuLinkSchema).max(5).optional(),
  }),
  /** The storefront's real domain, so the writer knows what "our website" is. */
  storeUrl: z.string().optional(),
  blogs: z
    .array(z.object({ id: z.string(), handle: z.string(), title: z.string() }))
    .max(100)
    .optional(),
});

export const articleSyncBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  articles: z
    .array(
      z.object({
        articleId: z.string(),
        title: z.string().min(1),
        seoTitle: z.string().optional(),
        seoDescription: z.string().optional(),
        blogTitle: z.string().optional(),
        bodyHtml: z.string().min(1),
        featuredImage: z
          .object({ url: z.string().min(1), alt: z.string().default("") })
          .optional(),
      })
    )
    .min(1)
    .max(50),
});

export async function requireMrWrite(workspaceId: string) {
  return requireGalleryAuth({ workspaceId, requireWrite: true });
}

export async function requireMrAdmin(workspaceId: string) {
  return requireGalleryAuth({ workspaceId, requireWrite: true, requireAdmin: true });
}

export async function requireMrRead(workspaceId: string) {
  return requireGalleryAuth({ workspaceId });
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

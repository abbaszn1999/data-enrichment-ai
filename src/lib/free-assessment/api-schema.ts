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

/** Every PLP row from the uploaded sheet, sent once so Stage 1 can discover niches. No live store — this IS the catalog. */
const plpRowSchema = z.object({
  name: z.string().min(1).max(200),
  pageType: z.enum(["collection", "category", "brand"]),
  skuCount: z.number().int().nonnegative().max(10_000_000),
  description: z.string().max(2000).optional(),
});

export const agentAnalyzeBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  plpRows: z.array(plpRowSchema).min(1).max(2000),
});

export const agentChatBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  stage: z.number().int().min(1).max(5).default(1),
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
  /** Full PLP catalog from the uploaded sheet, so chat can answer "what's on screen" questions. */
  plpRows: z.array(plpRowSchema).optional(),
});

export const agentSeedsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  storeLabel: z.string().max(200).optional(),
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
    .max(2000),
});

// Stage 4 classifies each term purely on its own wording — no store name, no
// niche/collection list, no volume/difficulty/intent signal. Those fields
// already live on the keyword row from extraction and are never touched by
// classification, so they are intentionally not part of this request body.
//
// The route runs exclusively as a cursor job over the full extract archive
// (not a client-passed keyword list) — the client loops on `offset` until
// `done`, same pattern as the Apify extract poll.
export const agentIntentBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  mode: z.literal("archive"),
  offset: z.number().int().nonnegative(),
});

// Stage 5 (Gemini collection clustering) is likewise a cursor job over the
// full classified archive — thousands of surviving category terms is
// thousands of candidate collections, far past one request.
export const agentClusterBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  mode: z.literal("archive"),
  offset: z.number().int().nonnegative(),
});

// Stage 5 Phase 3 (duplicate-collection exclusion) runs once, after the
// Phase 2 cursor loop above has fully finished and the "collections" slice
// holds the complete final list — no offset/paging needed here.
export const agentDedupeCollectionsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
});

export async function requireFaWrite(workspaceId: string) {
  return requireGalleryAuth({ workspaceId, requireWrite: true });
}

export async function requireFaAdmin(workspaceId: string) {
  return requireGalleryAuth({ workspaceId, requireWrite: true, requireAdmin: true });
}

export async function requireFaRead(workspaceId: string) {
  return requireGalleryAuth({ workspaceId });
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

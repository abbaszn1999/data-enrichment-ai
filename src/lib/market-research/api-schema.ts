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
      })
    )
    .min(1)
    .max(100),
});

export const agentIntentBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  parentNiches: z.array(z.string()).optional(),
  collections: z.array(z.string()).optional(),
  keywords: z
    .array(
      z.object({
        id: z.string(),
        keyword: z.string().min(1),
        seed: z.string().optional(),
        volume: z.number().optional(),
        difficulty: z.number().optional(),
        intents: z.array(z.string()).optional(),
      })
    )
    .min(1)
    .max(2000),
});

export const agentClusterBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  parentNiches: z.array(z.string()).optional(),
  seedRows: z
    .array(
      z.object({
        id: z.string(),
        canonicalNicheSeed: z.string(),
        broadSeedVariation: z.string(),
        selectedCollection: z.string(),
        broadParentNiche: z.string(),
        productCount: z.number(),
        scopeMatch: z.string(),
      })
    )
    .optional(),
  keywords: z
    .array(
      z.object({
        id: z.string(),
        keyword: z.string().min(1),
        seed: z.string().optional(),
        volume: z.number().optional(),
        difficulty: z.number().optional(),
        plpConcept: z.string().optional(),
        reason: z.string().optional(),
      })
    )
    .min(1)
    .max(2000),
});

export const agentOnPageBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.optional(),
  parentNiches: z.array(z.string()).optional(),
  customInstructions: z
    .object({
      seoTitle: z.string().optional(),
      seoDescription: z.string().optional(),
      collectionDescription: z.string().optional(),
      faq: z.string().optional(),
    })
    .optional(),
  collections: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        headKeyword: z.string(),
        parentNiche: z.string(),
        volume: z.number(),
        difficulty: z.number(),
        productCount: z.number(),
        keywordCount: z.number(),
        status: z.enum(["new", "existing", "merge"]),
        existingName: z.string().optional(),
      })
    )
    .min(1)
    .max(100),
});

export async function requireMrWrite(workspaceId: string) {
  return requireGalleryAuth({ workspaceId, requireWrite: true });
}

export async function requireMrRead(workspaceId: string) {
  return requireGalleryAuth({ workspaceId });
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

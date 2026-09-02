// Import row enrichment API — one row per request (called by concurrent
// sidebar workers). Uses OpenAI Responses (Terra/Sol + web_search).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
  updateCachedCredits,
} from "@/lib/workspace-context";
import { sumCosts } from "@/lib/ai-pricing";
import { enrichRow, type EnrichSettings } from "@/lib/enrich";
import { deductCreditsIdempotent } from "@/lib/jobs/credits";
import { patchProjectRowsAdmin } from "@/lib/jobs/project-json";
import {
  resolveEnrichmentModel,
  type CategoryItem,
  type EnrichmentColumnType,
  type SessionKind,
  type WritingTone,
  type ContentLength,
} from "@/types";

export const maxDuration = 300;

type EnrichRow = {
  id: string;
  rowIndex: number;
  originalData: Record<string, string>;
};

type EnrichBody = {
  sessionId?: string;
  row?: EnrichRow;
  enabledColumns?: string[];
  enrichmentColumns?: Array<{
    id: string;
    label: string;
    description: string;
    type: string;
    enabled?: boolean;
    imageCount?: number;
    sourceCount?: number;
    maxCategories?: number;
    itemCount?: number;
    maxChars?: number;
    customInstruction?: string;
    writingTone?: string;
    contentLength?: string;
  }>;
  settings?: {
    enrichmentModel?: string;
    thinkingLevel?: string;
    outputLanguage?: string;
  };
  kind?: SessionKind;
  cmsType?: string;
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
  workspaceId?: string;
  userId?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EnrichBody;
    const {
      row,
      sessionId,
      enabledColumns,
      enrichmentColumns,
      settings,
      cmsType,
      workspaceCategories,
      categoriesRawRows,
      workspaceId,
    } = body;
    const kind: SessionKind = body.kind === "plp" ? "plp" : "product";

    if (!row?.originalData) {
      return NextResponse.json({ error: "No row provided" }, { status: 400 });
    }
    if (!enabledColumns || enabledColumns.length === 0) {
      return NextResponse.json(
        { error: "No enrichment columns selected" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let headers: Record<string, string> | undefined;
    let ctx: Awaited<ReturnType<typeof getWorkspaceContext>> | null = null;

    if (workspaceId) {
      ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
      headers = {
        "X-Context-Source": ctx.source,
        "Server-Timing": `ctx;dur=${ctx.durationMs.toFixed(1)}`,
      };

      if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
      }
      if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
        return NextResponse.json(
          { error: "INACTIVE_SUBSCRIPTION" },
          { status: 402, headers }
        );
      }
      if ((ctx.credits?.total ?? 0) <= 0) {
        return NextResponse.json({ error: "NO_CREDITS" }, { status: 402, headers });
      }
    }

    const enrichSettings: EnrichSettings = {
      enrichmentModel: resolveEnrichmentModel(settings?.enrichmentModel),
      outputLanguage: settings?.outputLanguage || "English",
    };

    console.log(
      `[API enrich] ${kind} row ${row.rowIndex} | tier: ${enrichSettings.enrichmentModel} | cols: ${enabledColumns.join(",")}`
    );

    const enriched = await enrichRow({
      productData: row.originalData,
      enabledColumns,
      enrichmentColumns: enrichmentColumns?.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        type: (c.type || "text") as EnrichmentColumnType,
        enabled: c.enabled !== false,
        imageCount: c.imageCount,
        sourceCount: c.sourceCount,
        maxCategories: c.maxCategories,
        itemCount: c.itemCount,
        maxChars: c.maxChars,
        customInstruction: c.customInstruction,
        writingTone: c.writingTone as WritingTone | undefined,
        contentLength: c.contentLength as ContentLength | undefined,
      })),
      settings: enrichSettings,
      kind,
      cmsType,
      workspaceCategories,
      categoriesRawRows,
    });

    const rowCostSummary = sumCosts(enriched.costs);

    if (workspaceId && sessionId) {
      const originalPatches: Record<string, string> = {};
      const enrichedData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(enriched.data as Record<string, unknown>)) {
        if (key.startsWith("existing__")) {
          originalPatches[key.replace("existing__", "")] = String(value ?? "");
        } else {
          enrichedData[key] = value;
        }
      }
      await patchProjectRowsAdmin({
        workspaceId,
        sessionId,
        patches: [
          {
            id: row.id,
            status: "done",
            errorMessage: undefined,
            enrichedData,
            originalData: Object.keys(originalPatches).length ? originalPatches : undefined,
          },
        ],
      });
    }

    if (
      workspaceId &&
      ctx?.subscription &&
      rowCostSummary.totalCredits > 0
    ) {
      try {
        const ownerUserId =
          ctx.subscription.user_id ?? ctx.ownerId ?? user.id;
        const deductResult = await deductCreditsIdempotent({
          ownerUserId,
          workspaceId,
          actorUserId: user.id,
          amount: rowCostSummary.totalCredits,
          operation: "catalog_intelligence",
          entityType: kind === "plp" ? "catalog_plp_row" : "catalog_row",
          entityId: row.id,
          idempotencyKey: sessionId
            ? `catalog_intelligence:${sessionId}:${row.id}`
            : `catalog_intelligence:${workspaceId}:${row.id}`,
          details: {
            rowIndex: row.rowIndex,
            enrichmentModel: enrichSettings.enrichmentModel,
            totalCost: rowCostSummary.totalCost,
            totalTokens: rowCostSummary.totalTokens,
          },
        });
        if (!deductResult.success) {
          console.warn(
            `[API enrich] Credit rejected: ${deductResult.error || "unknown"}`
          );
          return NextResponse.json(
            { error: deductResult.error || "NO_CREDITS" },
            { status: 402, headers }
          );
        }
        const remaining = Number(deductResult.remaining);
        if (Number.isFinite(remaining)) {
          updateCachedCredits(workspaceId, remaining);
        }
        console.log(
          `[API enrich] Deducted ${rowCostSummary.totalCredits} credits. Remaining: ${deductResult.remaining}`
        );
      } catch (err) {
        console.error(
          `[API enrich] Credit exception: ${(err as Error).message}`
        );
      }
    }

    return NextResponse.json(
      {
        status: "done",
        id: row.id,
        rowIndex: row.rowIndex,
        data: enriched.data,
        cost: {
          totalCost: rowCostSummary.totalCost,
          totalCredits: rowCostSummary.totalCredits,
          totalTokens: rowCostSummary.totalTokens,
        },
      },
      { headers }
    );
  } catch (error) {
    console.error(`[API enrich] Error:`, (error as Error).message);
    return NextResponse.json(
      {
        status: "error",
        error: (error as Error).message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

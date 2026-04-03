import { NextRequest, NextResponse } from "next/server";
import { enrichProductRow } from "@/lib/gemini";
import type { GeminiSettings } from "@/lib/gemini";
import type { CategoryItem } from "@/types";
import { sumCosts } from "@/lib/ai-pricing";
import { getOwnerSubscription, calculateCreditBalance, isSubscriptionActive } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 60;

// Processes ONE row per request — client calls sequentially to avoid timeout
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    row,
    enabledColumns,
    enrichmentColumns,
    settings,
    cmsType,
    workspaceCategories,
    categoriesRawRows,
    workspaceId,
  }: {
    row: { id: string; rowIndex: number; originalData: Record<string, string> };
    enabledColumns: string[];
    enrichmentColumns?: { id: string; label: string; description: string; type: string; enabled: boolean; imageCount?: number; sourceCount?: number; maxCategories?: number; customInstruction?: string; writingTone?: string; contentLength?: string }[];
    settings?: GeminiSettings;
    cmsType?: string;
    workspaceCategories?: CategoryItem[];
    categoriesRawRows?: Record<string, string>[];
    workspaceId?: string;
  } = body;

  if (!row) {
    return NextResponse.json({ error: "No row provided" }, { status: 400 });
  }
  if (!enabledColumns || enabledColumns.length === 0) {
    return NextResponse.json({ error: "No enrichment columns selected" }, { status: 400 });
  }

  // Check credits
  if (workspaceId) {
    try {
      const ownerSub = await getOwnerSubscription(workspaceId);
      if (!ownerSub || !isSubscriptionActive(ownerSub.subscription.status)) {
        return NextResponse.json({ error: "NO_CREDITS" }, { status: 402 });
      }
      const bal = calculateCreditBalance(ownerSub.subscription);
      if (bal.total <= 0) {
        return NextResponse.json({ error: "NO_CREDITS" }, { status: 402 });
      }
    } catch { /* no subscription = allow for now */ }
  }

  try {
    console.log(`[API] Starting enrichment for row ${row.rowIndex}`);
    const enrichedData = await enrichProductRow(
      row.originalData,
      enabledColumns,
      enrichmentColumns,
      settings,
      cmsType,
      workspaceCategories,
      categoriesRawRows
    );
    console.log(`[API] Success for row ${row.rowIndex}`);

    const rowCostSummary = enrichedData.costs ? sumCosts(enrichedData.costs) : null;

    // Deduct credits
    if (workspaceId && rowCostSummary && rowCostSummary.totalCredits > 0) {
      try {
        const admin = createAdminClient();
        // Get user from Authorization header (middleware excluded for this route)
        const authHeader = request.headers.get("authorization") ?? "";
        const accessToken = authHeader.replace("Bearer ", "");
        let userId: string | undefined;
        if (accessToken) {
          const { data: { user } } = await admin.auth.getUser(accessToken);
          userId = user?.id;
        }
        const ownerSub = await getOwnerSubscription(workspaceId);
        if (ownerSub) {
          await admin.rpc("deduct_user_credits", {
            p_user_id: ownerSub.ownerId,
            p_amount: rowCostSummary.totalCredits,
            p_workspace_id: workspaceId,
            p_operation: "ai_enrichment",
            p_uid: userId,
            p_details: { rowIndex: row.rowIndex },
          });
        }
      } catch (err: any) {
        console.warn(`[Credits] Deduction failed: ${err?.message}`);
      }
    }

    return NextResponse.json({
      status: "done",
      id: row.id,
      rowIndex: row.rowIndex,
      data: enrichedData.data,
      cost: rowCostSummary ? {
        totalCost: rowCostSummary.totalCost,
        totalCredits: rowCostSummary.totalCredits,
        totalTokens: rowCostSummary.totalTokens,
      } : undefined,
    });
  } catch (error) {
    console.error(`[API] Error enriching row ${row.rowIndex}:`, error);
    return NextResponse.json({
      status: "error",
      id: row.id,
      rowIndex: row.rowIndex,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

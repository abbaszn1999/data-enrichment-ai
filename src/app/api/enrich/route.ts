import { NextRequest, NextResponse } from "next/server";
import { enrichProductRow } from "@/lib/gemini";
import type { GeminiSettings } from "@/lib/gemini";
import type { CategoryItem } from "@/types";
import { sumCosts } from "@/lib/ai-pricing";
import { createClient } from "@/lib/supabase-server";
import { getOwnerSubscription, calculateCreditBalance, isSubscriptionActive } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    rows,
    enabledColumns,
    enrichmentColumns,
    settings,
    cmsType,
    workspaceCategories,
    categoriesRawRows,
    workspaceId,
  }: {
    rows: { id: string; rowIndex: number; originalData: Record<string, string> }[];
    enabledColumns: string[];
    enrichmentColumns?: { id: string; label: string; description: string; type: string; enabled: boolean; imageCount?: number; sourceCount?: number; maxCategories?: number; customInstruction?: string; writingTone?: string; contentLength?: string }[];
    settings?: GeminiSettings;
    cmsType?: string;
    workspaceCategories?: CategoryItem[];
    categoriesRawRows?: Record<string, string>[];
    workspaceId?: string;
  } = body;

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }
  if (!enabledColumns || enabledColumns.length === 0) {
    return NextResponse.json({ error: "No enrichment columns selected" }, { status: 400 });
  }

  // Helper: get credit balance
  async function getCreditsRemaining(): Promise<{ remaining: number; ownerId: string | null }> {
    if (!workspaceId) return { remaining: Infinity, ownerId: null };
    try {
      const ownerSub = await getOwnerSubscription(workspaceId);
      if (!ownerSub || !isSubscriptionActive(ownerSub.subscription.status)) {
        return { remaining: 0, ownerId: ownerSub?.ownerId ?? null };
      }
      const bal = calculateCreditBalance(ownerSub.subscription);
      return { remaining: bal.total, ownerId: ownerSub.ownerId };
    } catch { return { remaining: 0, ownerId: null }; }
  }

  // Helper: deduct credits
  async function deductCredits(credits: number, rowIndex: number) {
    if (!workspaceId || credits <= 0) return;
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const ownerSub = await getOwnerSubscription(workspaceId);
      if (!ownerSub) return;
      const admin = createAdminClient();
      await admin.rpc("deduct_user_credits", {
        p_user_id: ownerSub.ownerId,
        p_amount: credits,
        p_workspace_id: workspaceId,
        p_operation: "ai_enrichment",
        p_uid: user?.id,
        p_details: { rowIndex },
      });
    } catch (err: any) {
      console.warn(`[Credits] Deduction failed: ${err?.message}`);
    }
  }

  // Pre-check credits
  if (workspaceId) {
    const { remaining } = await getCreditsRemaining();
    if (remaining <= 0) {
      return NextResponse.json({ error: "NO_CREDITS" }, { status: 402 });
    }
  }

  const results: { id: string; rowIndex: number; status: "done" | "error"; data?: any; error?: string; cost?: any }[] = [];
  const allCosts: any[] = [];

  for (const row of rows) {
    // Check credits before each row
    if (workspaceId) {
      const { remaining } = await getCreditsRemaining();
      if (remaining <= 0) {
        results.push({ id: row.id, rowIndex: row.rowIndex, status: "error", error: "NO_CREDITS" });
        break;
      }
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

      if (enrichedData.costs) allCosts.push(...enrichedData.costs);
      const rowCostSummary = enrichedData.costs ? sumCosts(enrichedData.costs) : null;
      if (rowCostSummary) await deductCredits(rowCostSummary.totalCredits, row.rowIndex);

      results.push({
        id: row.id,
        rowIndex: row.rowIndex,
        status: "done",
        data: enrichedData.data,
        cost: rowCostSummary ? {
          totalCost: rowCostSummary.totalCost,
          totalCredits: rowCostSummary.totalCredits,
          totalTokens: rowCostSummary.totalTokens,
        } : undefined,
      });
    } catch (error) {
      console.error(`[API] Error enriching row ${row.rowIndex}:`, error);
      results.push({
        id: row.id,
        rowIndex: row.rowIndex,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const totalSummary = allCosts.length > 0 ? sumCosts(allCosts) : null;
  if (totalSummary) {
    console.log(`[API] Batch total: $${totalSummary.totalCost.toFixed(6)} (${totalSummary.totalCredits} credits, ${totalSummary.totalTokens} tokens)`);
  }

  return NextResponse.json({
    results,
    totalCost: totalSummary ? {
      totalCost: totalSummary.totalCost,
      totalCredits: totalSummary.totalCredits,
      totalTokens: totalSummary.totalTokens,
    } : null,
  });
}

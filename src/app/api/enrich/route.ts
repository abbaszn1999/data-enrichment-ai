import { NextRequest } from "next/server";
import { enrichProductRow } from "@/lib/gemini";
import type { GeminiSettings } from "@/lib/gemini";
import type { CategoryItem } from "@/types";
import { sumCosts } from "@/lib/ai-pricing";
import { getOwnerSubscription, calculateCreditBalance, isSubscriptionActive } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "edge";
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
    return new Response(JSON.stringify({ error: "No rows provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!enabledColumns || enabledColumns.length === 0) {
    return new Response(JSON.stringify({ error: "No enrichment columns selected" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Get user id from Authorization header (works in Edge Runtime)
  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.replace("Bearer ", "");

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
      const ownerSub = await getOwnerSubscription(workspaceId);
      if (!ownerSub) return;
      const admin = createAdminClient();
      await admin.rpc("deduct_user_credits", {
        p_user_id: ownerSub.ownerId,
        p_amount: credits,
        p_workspace_id: workspaceId,
        p_operation: "ai_enrichment",
        p_uid: accessToken ? (await admin.auth.getUser(accessToken)).data.user?.id : undefined,
        p_details: { rowIndex },
      });
    } catch (err: any) {
      console.warn(`[Credits] Deduction failed: ${err?.message}`);
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let completedRows = 0;
      const allCosts: any[] = [];

      function send(event: object) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { /* closed */ }
      }

      // Keepalive comment every 15s to prevent 504 inactivity timeout
      function sendKeepalive() {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { /* closed */ }
      }
      const keepaliveInterval = setInterval(sendKeepalive, 15000);

      try {
        // Pre-check credits
        if (workspaceId) {
          const { remaining } = await getCreditsRemaining();
          if (remaining <= 0) {
            send({ type: "error", error: "NO_CREDITS", rowId: "", rowIndex: -1, totalRows: rows.length, completedRows: 0 });
            return;
          }
        }

        for (const row of rows) {
          if (workspaceId) {
            const { remaining } = await getCreditsRemaining();
            if (remaining <= 0) {
              send({ type: "error", error: "NO_CREDITS", rowId: row.id, rowIndex: row.rowIndex, totalRows: rows.length, completedRows });
              break;
            }
          }

          send({ type: "progress", rowId: row.id, rowIndex: row.rowIndex, totalRows: rows.length, completedRows });
          console.log(`[API] Starting enrichment for row ${row.rowIndex}`);

          try {
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
            completedRows++;

            if (enrichedData.costs) allCosts.push(...enrichedData.costs);
            const rowCostSummary = enrichedData.costs ? sumCosts(enrichedData.costs) : null;
            if (rowCostSummary) await deductCredits(rowCostSummary.totalCredits, row.rowIndex);

            send({
              type: "row_complete",
              rowId: row.id,
              rowIndex: row.rowIndex,
              data: enrichedData.data,
              totalRows: rows.length,
              completedRows,
              cost: rowCostSummary ? {
                totalCost: rowCostSummary.totalCost,
                totalCredits: rowCostSummary.totalCredits,
                totalTokens: rowCostSummary.totalTokens,
              } : undefined,
            });
          } catch (error) {
            completedRows++;
            console.error(`[API] Error enriching row ${row.rowIndex}:`, error);
            send({
              type: "row_error",
              rowId: row.id,
              rowIndex: row.rowIndex,
              error: error instanceof Error ? error.message : "Unknown error",
              totalRows: rows.length,
              completedRows,
            });
          }
        }

        const totalSummary = allCosts.length > 0 ? sumCosts(allCosts) : null;
        if (totalSummary) {
          console.log(`[API] Batch total: $${totalSummary.totalCost.toFixed(6)} (${totalSummary.totalCredits} credits, ${totalSummary.totalTokens} tokens)`);
        }

        send({
          type: "done",
          rowId: "",
          rowIndex: -1,
          totalRows: rows.length,
          completedRows,
          totalCost: totalSummary ? {
            totalCost: totalSummary.totalCost,
            totalCredits: totalSummary.totalCredits,
            totalTokens: totalSummary.totalTokens,
          } : undefined,
        });
      } finally {
        clearInterval(keepaliveInterval);
        controller.close();
      }
    },
    cancel() {
      console.log("[API] Client disconnected");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

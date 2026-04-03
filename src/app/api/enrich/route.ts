import { NextRequest } from "next/server";
import { enrichProductRow } from "@/lib/gemini";
import type { GeminiSettings } from "@/lib/gemini";
import type { EnrichmentEvent, CategoryItem } from "@/types";
import { sumCosts, costToCredits } from "@/lib/ai-pricing";
import { createClient } from "@/lib/supabase-server";
import { getOwnerSubscription, calculateCreditBalance, isSubscriptionActive } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 300;

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
    return new Response(JSON.stringify({ error: "No rows provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!enabledColumns || enabledColumns.length === 0) {
    return new Response(
      JSON.stringify({ error: "No enrichment columns selected" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      controllerRef = controller;
      let completedRows = 0;
      const allCosts: any[] = [];

      function sendEvent(event: any) {
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream may be closed
        }
      }

      // Helper: get credit balance for this workspace (per-user model)
      async function getCreditsRemaining(): Promise<{ remaining: number; total: number; ownerId: string | null }> {
        if (!workspaceId) return { remaining: Infinity, total: 0, ownerId: null };
        try {
          const ownerSub = await getOwnerSubscription(workspaceId);
          if (!ownerSub || !isSubscriptionActive(ownerSub.subscription.status)) {
            return { remaining: 0, total: 0, ownerId: ownerSub?.ownerId ?? null };
          }
          const bal = calculateCreditBalance(ownerSub.subscription);
          return { remaining: bal.total, total: bal.monthlyTotal + bal.bonus, ownerId: ownerSub.ownerId };
        } catch { return { remaining: 0, total: 0, ownerId: null }; }
      }

      // Helper: deduct credits and log transaction (per-user model)
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

      // Pre-check: does workspace have any credits left?
      if (workspaceId) {
        const { remaining } = await getCreditsRemaining();
        if (remaining <= 0) {
          sendEvent({
            type: "error",
            rowId: "",
            rowIndex: -1,
            error: "NO_CREDITS",
            totalRows: rows.length,
            completedRows: 0,
          });
          controller.close();
          return;
        }
      }

      for (const row of rows) {
        try {
          // Check credits before each row
          if (workspaceId) {
            const { remaining } = await getCreditsRemaining();
            if (remaining <= 0) {
              sendEvent({
                type: "error",
                rowId: row.id,
                rowIndex: row.rowIndex,
                error: "NO_CREDITS",
                totalRows: rows.length,
                completedRows,
              });
              break;
            }
          }

          sendEvent({
            type: "progress",
            rowId: row.id,
            rowIndex: row.rowIndex,
            totalRows: rows.length,
            completedRows,
          });

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
          completedRows++;

          // Track costs
          if (enrichedData.costs) {
            allCosts.push(...enrichedData.costs);
          }
          const rowCostSummary = enrichedData.costs ? sumCosts(enrichedData.costs) : null;

          // Deduct credits for this row
          if (rowCostSummary) {
            await deductCredits(rowCostSummary.totalCredits, row.rowIndex);
          }

          sendEvent({
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
          
          let errorMessage = "Unknown error occurred";
          if (error instanceof Error) {
            errorMessage = error.message;
            if ((error as any).status) {
               console.error(`[API] Status code:`, (error as any).status);
            }
            if ((error as any).details) {
               console.error(`[API] Details:`, (error as any).details);
            }
          }

          sendEvent({
            type: "row_error",
            rowId: row.id,
            rowIndex: row.rowIndex,
            error: errorMessage,
            totalRows: rows.length,
            completedRows,
          });
        }
      }

      // Summarize total costs across all rows
      const totalSummary = allCosts.length > 0 ? sumCosts(allCosts) : null;
      if (totalSummary) {
        console.log(`[API] Batch total: $${totalSummary.totalCost.toFixed(6)} (${totalSummary.totalCredits} credits, ${totalSummary.totalTokens} tokens)`);
      }

      sendEvent({
        type: "done",
        rowId: "",
        rowIndex: -1,
        totalRows: rows.length,
        completedRows,
        totalCost: totalSummary ? {
          totalCost: totalSummary.totalCost,
          totalCredits: totalSummary.totalCredits,
          totalTokens: totalSummary.totalTokens,
          breakdown: totalSummary.breakdown,
        } : undefined,
      });

      controller.close();
    },
    cancel() {
      // Cleanup if the client disconnects
      console.log("[API] Client disconnected stream");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

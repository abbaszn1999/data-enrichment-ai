import { NextRequest } from "next/server";
import { enrichProductRow } from "@/lib/gemini";
import type { GeminiSettings } from "@/lib/gemini";
import type { EnrichmentEvent, CategoryItem } from "@/types";

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
  }: {
    rows: { id: string; rowIndex: number; originalData: Record<string, string> }[];
    enabledColumns: string[];
    enrichmentColumns?: { id: string; label: string; description: string; type: string; enabled: boolean; imageCount?: number; sourceCount?: number; maxCategories?: number; customInstruction?: string; writingTone?: string; contentLength?: string }[];
    settings?: GeminiSettings;
    cmsType?: string;
    workspaceCategories?: CategoryItem[];
    categoriesRawRows?: Record<string, string>[];
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

      function sendEvent(event: EnrichmentEvent) {
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream may be closed
        }
      }

      for (const row of rows) {
        try {
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

          sendEvent({
            type: "row_complete",
            rowId: row.id,
            rowIndex: row.rowIndex,
            data: enrichedData,
            totalRows: rows.length,
            completedRows,
          });
        } catch (error) {
          completedRows++;
          console.error(`[API] Error enriching row ${row.rowIndex}:`, error);
          
          let errorMessage = "Unknown error occurred";
          if (error instanceof Error) {
            errorMessage = error.message;
            // Detailed logging for API errors
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

      sendEvent({
        type: "done",
        rowId: "",
        rowIndex: -1,
        totalRows: rows.length,
        completedRows,
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

"use client";

import { useCallback, useState } from "react";
import {
  Sparkles,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useSheetStore } from "@/store/sheet-store";
import type { EnrichmentEvent } from "@/types";

export function EnrichmentPanel() {
  const {
    rows,
    enrichmentColumns,
    toggleEnrichmentColumn,
    setAllEnrichmentColumns,
    isEnriching,
    setIsEnriching,
    enrichProgress,
    totalToEnrich,
    completedEnrich,
    errorCount,
    setRowStatus,
    setRowEnrichedData,
    setEnrichProgress,
    incrementError,
    resetEnrichState,
  } = useSheetStore();

  const [lastError, setLastError] = useState<string | null>(null);

  const enabledColumns = enrichmentColumns
    .filter((col) => col.enabled)
    .map((col) => col.id);

  const handleEnrich = useCallback(async () => {
    if (enabledColumns.length === 0) return;

    const pendingRows = rows.filter(
      (row) => row.status === "pending" || row.status === "error"
    );
    if (pendingRows.length === 0) return;

    setIsEnriching(true);
    setEnrichProgress(0, pendingRows.length);
    setLastError(null); // Clear previous errors

    for (const row of pendingRows) {
      setRowStatus(row.id, "processing");
    }

    try {
      const response = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: pendingRows.map((r) => ({
            id: r.id,
            rowIndex: r.rowIndex,
            originalData: r.originalData,
          })),
          enabledColumns,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} - ${await response.text()}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const dataLine = line.trim();
          if (!dataLine.startsWith("data: ")) continue;

          try {
            const event: EnrichmentEvent = JSON.parse(
              dataLine.slice(6)
            );

            switch (event.type) {
              case "progress":
                setRowStatus(event.rowId, "processing");
                break;

              case "row_complete":
                if (event.data) {
                  setRowEnrichedData(event.rowId, event.data);
                }
                setEnrichProgress(event.completedRows, event.totalRows);
                break;

              case "row_error":
                setRowStatus(event.rowId, "error", event.error);
                setEnrichProgress(event.completedRows, event.totalRows);
                incrementError();
                if (event.error) {
                  setLastError(event.error);
                }
                break;

              case "done":
                setIsEnriching(false);
                break;
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (error) {
      console.error("Enrichment failed:", error);
      setLastError(error instanceof Error ? error.message : "Unknown error occurred");
      setIsEnriching(false);
    }
  }, [
    rows,
    enabledColumns,
    setIsEnriching,
    setEnrichProgress,
    setRowStatus,
    setRowEnrichedData,
    incrementError,
  ]);

  const doneCount = rows.filter((r) => r.status === "done").length;
  const allDone = doneCount === rows.length && rows.length > 0;

  return (
    <Card className="p-4 space-y-4 shadow-sm border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-sm">AI Enrichment Columns</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => setAllEnrichmentColumns(true)}
          >
            All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => setAllEnrichmentColumns(false)}
          >
            None
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {enrichmentColumns.map((col) => (
          <Badge
            key={col.id}
            variant={col.enabled ? "default" : "outline"}
            className={`cursor-pointer transition-all text-xs px-3 py-1 ${
              col.enabled
                ? "bg-primary hover:bg-primary/80 shadow-sm"
                : "hover:bg-muted text-muted-foreground"
            }`}
            onClick={() => toggleEnrichmentColumn(col.id)}
          >
            {col.label}
          </Badge>
        ))}
      </div>

      <Separator className="bg-border/50" />

      {isEnriching && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="font-medium">Enriching...</span>
            </span>
            <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
              {completedEnrich} / {totalToEnrich}
            </span>
          </div>
          <Progress value={enrichProgress} className="h-2" />
        </div>
      )}

      {!isEnriching && (doneCount > 0 || errorCount > 0) && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4 text-sm">
            {doneCount > 0 && (
              <span className="flex items-center gap-1.5 text-green-600 bg-green-50 dark:bg-green-950/30 px-2 py-1 rounded-md font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {doneCount} enriched
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1.5 text-destructive bg-destructive/10 px-2 py-1 rounded-md font-medium">
                <AlertCircle className="h-4 w-4" />
                {errorCount} errors
              </span>
            )}
          </div>
          
          {errorCount > 0 && lastError && (
            <div className="text-xs text-destructive/80 bg-destructive/5 p-3 rounded-md border border-destructive/20 break-words">
              <span className="font-semibold block mb-1">Last Error:</span>
              {lastError}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {!isEnriching && !allDone && (
          <Button
            onClick={handleEnrich}
            disabled={enabledColumns.length === 0 || rows.length === 0}
            className="gap-2 font-medium"
          >
            <Play className="h-4 w-4" />
            Enrich {rows.filter((r) => r.status === "pending" || r.status === "error").length} Rows
          </Button>
        )}

        {allDone && (
          <Button variant="outline" onClick={resetEnrichState} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Re-enrich All
          </Button>
        )}
      </div>
    </Card>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ExtractedKeyword, KeywordSheet } from "./workspace-data";

export function StageAnalyzePanel({
  keywords,
  loading,
  onNext,
}: {
  keywords: ExtractedKeyword[];
  loading: boolean;
  onNext: () => void;
}) {
  const [sheet, setSheet] = useState<KeywordSheet>("informational");
  const rows = useMemo(
    () => keywords.filter((row) => row.sheet === sheet),
    [keywords, sheet]
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Analyze</h2>
          <p className="text-[11px] text-muted-foreground">
            Two sheets — informational queries stay out of category building.
          </p>
        </div>
        <div className="flex rounded-lg border border-border/70 p-0.5">
          {(
            [
              ["informational", "Informational keywords"],
              ["category", "Suitable for categories"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSheet(id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium",
                sheet === id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
        {loading ? (
          <div className="divide-y divide-border/60">
            <div className="grid grid-cols-4 gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>Keyword</span>
              <span>Volume</span>
              <span>KD</span>
              <span>{sheet === "category" ? "Products" : "Type"}</span>
            </div>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="grid grid-cols-4 gap-3 px-4 py-3">
                <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-12 animate-pulse rounded bg-muted" />
                <div className="h-3 w-8 animate-pulse rounded bg-muted" />
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Keyword</TableHead>
                <TableHead className="text-xs">Seed</TableHead>
                <TableHead className="text-xs text-right">Volume</TableHead>
                <TableHead className="text-xs text-right">KD</TableHead>
                {sheet === "category" ? (
                  <TableHead className="text-xs text-right">Products</TableHead>
                ) : (
                  <TableHead className="text-xs">Question</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm">{row.keyword}</TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {row.seed}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.volume.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.difficulty}
                  </TableCell>
                  {sheet === "category" ? (
                    <TableCell className="text-xs tabular-nums text-right">
                      {row.productMatches.toLocaleString("en-US")}
                    </TableCell>
                  ) : (
                    <TableCell className="text-[11px] text-muted-foreground">
                      {row.isQuestion ? "Yes" : "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 shrink-0">
        <p className="text-[11px] text-muted-foreground">
          Next clusters category-suitable keywords into collection candidates.
        </p>
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={onNext}
          disabled={loading}
        >
          Next · Collections
        </Button>
      </div>
    </div>
  );
}

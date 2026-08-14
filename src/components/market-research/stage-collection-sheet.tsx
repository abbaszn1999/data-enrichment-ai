"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsd } from "./mock-data";
import {
  USD_PER_COLLECTION,
  collectionCharge,
  type ProposedCollection,
} from "./workspace-data";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<ProposedCollection["status"], string> = {
  new: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  existing:
    "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25",
  merge: "bg-amber-500/12 text-amber-800 dark:text-amber-300 border-amber-500/25",
};

export function StageCollectionSheet({
  collections,
  loading,
  selectedIds,
  onChangeSelected,
  paid,
  onStart,
}: {
  collections: ProposedCollection[];
  loading: boolean;
  selectedIds: string[];
  onChangeSelected: (ids: string[]) => void;
  paid: boolean;
  onStart: () => void;
}) {
  const [minVolume, setMinVolume] = useState(0);
  const [maxKd, setMaxKd] = useState(100);
  const [minProducts, setMinProducts] = useState(0);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const visible = useMemo(
    () =>
      collections.filter(
        (row) =>
          row.volume >= minVolume &&
          row.difficulty <= maxKd &&
          row.productCount >= minProducts
      ),
    [collections, minVolume, maxKd, minProducts]
  );

  const toggle = (id: string) => {
    if (paid) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelected([...next]);
  };

  const cost = collectionCharge(selected.size);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm font-medium">Building collection sheet…</p>
        <p className="max-w-sm text-center text-[11px] text-muted-foreground">
          Clustering category-suitable keywords and matching them to products
          already in the catalog.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3">
      <div className="shrink-0">
        <h2 className="text-base font-semibold tracking-tight">
          Collection sheet
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Select the collections to build. {formatUsd(USD_PER_COLLECTION)} each,
          charged from your wallet when you start.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 shrink-0">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Min volume
          <Input
            type="number"
            min={0}
            value={minVolume}
            onChange={(e) => setMinVolume(Number(e.target.value) || 0)}
            className="h-8 w-[96px] text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Max KD
          <Input
            type="number"
            min={0}
            max={100}
            value={maxKd}
            onChange={(e) => setMaxKd(Number(e.target.value) || 0)}
            className="h-8 w-[72px] text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Min products
          <Input
            type="number"
            min={0}
            value={minProducts}
            onChange={(e) => setMinProducts(Number(e.target.value) || 0)}
            className="h-8 w-[88px] text-xs"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-9" />
              <TableHead className="text-xs">Collection</TableHead>
              <TableHead className="text-xs">Head keyword</TableHead>
              <TableHead className="text-xs text-right">Volume</TableHead>
              <TableHead className="text-xs text-right">KD</TableHead>
              <TableHead className="text-xs text-right">Products</TableHead>
              <TableHead className="text-xs text-right">Keywords</TableHead>
              <TableHead className="text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const on = selected.has(row.id);
              return (
                <TableRow
                  key={row.id}
                  className={cn(on && "bg-primary/5")}
                  onClick={() => toggle(row.id)}
                >
                  <TableCell>
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border"
                      )}
                    >
                      {on ? "✓" : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {row.name}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.headKeyword}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.volume.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.difficulty}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.productCount.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-right">
                    {row.keywordCount}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-medium capitalize",
                        STATUS_CLASS[row.status]
                      )}
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 shrink-0">
        <p className="text-xs">
          {selected.size === 0
            ? "Select at least one collection"
            : `${selected.size} collection${selected.size === 1 ? "" : "s"} · ${formatUsd(USD_PER_COLLECTION)} × ${selected.size} = ${formatUsd(cost)}`}
        </p>
        <Button
          size="sm"
          className="h-8 text-xs"
          disabled={selected.size === 0 || paid}
          onClick={onStart}
        >
          {paid ? "Working started" : `Start working · ${formatUsd(cost)}`}
        </Button>
      </div>
    </div>
  );
}

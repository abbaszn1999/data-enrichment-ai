"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Columns3, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "./ga-ui";

export type GaColumn<T> = {
  id: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string;
  align?: "left" | "right" | "center";
  /** Tailwind width class, e.g. "w-64". */
  width?: string;
  total?: ReactNode;
  /** Keep visible while scrolling horizontally. */
  sticky?: boolean;
  /** Plain-text name for the column picker and CSV header. */
  label?: string;
  /** Can be hidden from the column picker. */
  hideable?: boolean;
  defaultHidden?: boolean;
  /** CSV cell; falls back to sortValue. */
  csv?: (row: T) => string | number;
};

export function GaTable<T>({
  rows,
  columns: allColumns,
  rowKey,
  selectable,
  selected,
  onSelectedChange,
  bulkActions,
  onRowClick,
  empty,
  defaultSort,
  totalsLabel = "Total",
  rowClassName,
  exportName,
}: {
  rows: T[];
  columns: GaColumn<T>[];
  rowKey: (row: T) => string;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Shown in a bar above the table while rows are selected. */
  bulkActions?: (ids: string[]) => ReactNode;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  defaultSort?: { id: string; dir: "asc" | "desc" };
  totalsLabel?: string;
  rowClassName?: (row: T) => string | undefined;
  /** Shows the Columns / Download toolbar; the file is named after it. */
  exportName?: string;
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(allColumns.filter((c) => c.defaultHidden).map((c) => c.id)));
  const columns = allColumns.filter((c) => !hidden.has(c.id));
  const labelOf = (c: GaColumn<T>) => c.label ?? (typeof c.header === "string" && c.header ? c.header : c.id);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
    });
  }, [rows, columns, sort]);

  const sel = selected ?? new Set<string>();
  const allIds = rows.map(rowKey);
  const allChecked = allIds.length > 0 && allIds.every((id) => sel.has(id));
  const someChecked = !allChecked && allIds.some((id) => sel.has(id));
  const hasTotals = columns.some((c) => c.total !== undefined);

  const toggleSort = (col: GaColumn<T>) => {
    if (!col.sortValue) return;
    setSort((s) => (s?.id === col.id ? { id: col.id, dir: s.dir === "desc" ? "asc" : "desc" } : { id: col.id, dir: "desc" }));
  };

  const downloadCsv = () => {
    const cols = columns.filter((c) => c.csv || c.sortValue);
    const esc = (v: string | number) => {
      const t = String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = [cols.map((c) => esc(labelOf(c))).join(","), ...sorted.map((r) => cols.map((c) => esc((c.csv ?? c.sortValue)!(r))).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "report"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const alignClass = (a?: "left" | "right" | "center") => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
      {exportName && (
        <div className="flex items-center justify-end gap-1.5 border-b border-border/60 px-3 py-1.5">
          <span className="mr-auto text-[11px] text-muted-foreground">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
          {allColumns.some((c) => c.hideable) && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                <Columns3 className="h-3.5 w-3.5" /> Columns
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-52 overflow-y-auto">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Show columns</DropdownMenuLabel>
                {allColumns.filter((c) => c.hideable).map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={!hidden.has(c.id)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(v) =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (v) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className="text-xs"
                  >
                    {labelOf(c)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <Download className="h-3.5 w-3.5" /> Download CSV
          </button>
        </div>
      )}
      {selectable && sel.size > 0 && bulkActions && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-[#400095]/[0.04] px-3 py-2 dark:bg-violet-500/10">
          <span className="text-xs font-semibold">{sel.size} selected</span>
          <span className="h-4 w-px bg-border" />
          {bulkActions([...sel])}
          <button
            type="button"
            onClick={() => onSelectedChange?.(new Set())}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              {selectable && (
                <th className="w-9 px-3 py-2.5">
                  <Checkbox
                    label="Select all"
                    checked={allChecked}
                    indeterminate={someChecked}
                    onChange={(v) => onSelectedChange?.(v ? new Set(allIds) : new Set())}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.id}
                  onClick={() => toggleSort(col)}
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold text-muted-foreground",
                    alignClass(col.align),
                    col.width,
                    col.sortValue && "cursor-pointer select-none hover:text-foreground",
                    col.sticky && "sticky left-0 z-10 bg-muted/30 backdrop-blur"
                  )}
                >
                  <span className={cn("inline-flex items-center gap-1", col.align === "right" && "flex-row-reverse")}>
                    {col.header}
                    {sort?.id === col.id && (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-10 text-center text-xs text-muted-foreground">
                  {empty ?? "Nothing to show."}
                </td>
              </tr>
            )}
            {sorted.map((row) => {
              const id = rowKey(row);
              const isSel = sel.has(id);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "group border-b border-border/40 transition-colors last:border-b-0",
                    isSel ? "bg-[#400095]/[0.04] dark:bg-violet-500/10" : "hover:bg-muted/40",
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row)
                  )}
                >
                  {selectable && (
                    <td className="px-3 py-2.5">
                      <Checkbox
                        label="Select row"
                        checked={isSel}
                        onChange={(v) => {
                          const next = new Set(sel);
                          if (v) next.add(id);
                          else next.delete(id);
                          onSelectedChange?.(next);
                        }}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        "px-3 py-2.5 align-middle",
                        alignClass(col.align),
                        col.align === "right" && "tabular-nums",
                        col.width,
                        col.sticky && "sticky left-0 z-[1] bg-card"
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {hasTotals && sorted.length > 0 && (
            <tfoot>
              <tr className="border-t border-border/60 bg-muted/30 font-semibold">
                {selectable && <td />}
                {columns.map((col, i) => (
                  <td key={col.id} className={cn("whitespace-nowrap px-3 py-2.5 tabular-nums", alignClass(col.align), col.sticky && "sticky left-0 bg-muted/30")}>
                    {i === 0 && col.total === undefined ? totalsLabel : col.total}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** Small button used inside table bulk bars and row actions. */
export function BulkButton({ children, onClick, tone }: { children: ReactNode; onClick: () => void; tone?: "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted",
        tone === "danger" && "text-red-600 hover:bg-red-500/10"
      )}
    >
      {children}
    </button>
  );
}

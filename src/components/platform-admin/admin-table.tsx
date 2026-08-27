"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Inbox, SearchX } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PaginationBar } from "@/components/platform-admin/pagination-bar";
import type { SortState } from "@/lib/platform-admin/list-query";
import { cn } from "@/lib/utils";

export type AdminColumn<T> = {
  header: string;
  className?: string;
  cell: (row: T) => ReactNode;
  sortKey?: string;
  align?: "left" | "right";
  numeric?: boolean;
};

export function AdminTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty,
  emptyTitle,
  emptyDescription,
  onClearFilters,
  toolbar,
  sort,
  onSort,
  pagination,
  embedded,
}: {
  rows: T[];
  columns: AdminColumn<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onClearFilters?: () => void;
  toolbar?: ReactNode;
  sort?: SortState | null;
  onSort?: (key: string) => void;
  pagination?: {
    page: number;
    pageCount: number;
    total: number;
    pageSize?: number;
    onPage: (page: number) => void;
  };
  embedded?: boolean;
}) {
  const clickable = Boolean(onRowClick);
  const colCount = columns.length + (clickable ? 1 : 0);
  const isFilteredEmpty = rows.length === 0 && Boolean(onClearFilters);

  return (
    <div
      className={cn(
        "overflow-hidden bg-card",
        embedded ? "rounded-lg border" : "rounded-xl border shadow-sm"
      )}
    >
      {toolbar ? <div className="border-b px-4 py-3">{toolbar}</div> : null}
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-muted/50 backdrop-blur-sm dark:bg-muted/25">
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => {
              const alignedRight = column.align === "right" || column.numeric;
              const sortable = Boolean(column.sortKey && onSort);
              const active = sort?.key === column.sortKey;
              return (
                <TableHead
                  key={column.header}
                  className={cn(
                    "h-11 px-4 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase",
                    alignedRight && "text-right",
                    column.className
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md hover:text-foreground",
                        alignedRight && "ml-auto flex-row-reverse",
                        active && "text-foreground"
                      )}
                      onClick={() => onSort?.(column.sortKey!)}
                    >
                      {column.header}
                      {active ? (
                        sort?.dir === "desc" ? (
                          <ArrowDown className="size-3 opacity-70" />
                        ) : (
                          <ArrowUp className="size-3 opacity-70" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-35" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              );
            })}
            {clickable ? <TableHead className="w-8 px-2" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colCount} className="h-auto p-0">
                <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                  {isFilteredEmpty ? (
                    <SearchX className="mb-3 size-8 text-muted-foreground/60" />
                  ) : (
                    <Inbox className="mb-3 size-8 text-muted-foreground/60" />
                  )}
                  <p className="text-sm font-medium">
                    {emptyTitle ?? (isFilteredEmpty ? "No matching rows" : empty ?? "No rows")}
                  </p>
                  {emptyDescription ? (
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">{emptyDescription}</p>
                  ) : null}
                  {onClearFilters ? (
                    <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onClearFilters}>
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                className={cn(
                  "group border-border/70",
                  clickable && "cursor-pointer",
                  "hover:bg-[#400095]/[0.04] dark:hover:bg-[#F76D01]/[0.07]"
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => {
                  const alignedRight = column.align === "right" || column.numeric;
                  return (
                    <TableCell
                      key={column.header}
                      className={cn(
                        "px-4 py-3.5 text-sm",
                        alignedRight && "text-right tabular-nums",
                        column.numeric && "tabular-nums",
                        column.className
                      )}
                    >
                      {column.cell(row)}
                    </TableCell>
                  );
                })}
                {clickable ? (
                  <TableCell className="w-8 px-2">
                    <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {pagination ? (
        <div className="border-t bg-muted/20 px-4 py-2.5">
          <PaginationBar
            page={pagination.page}
            pageCount={pagination.pageCount}
            onPage={pagination.onPage}
            total={pagination.total}
            pageSize={pagination.pageSize}
          />
        </div>
      ) : null}
    </div>
  );
}

"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

export function WorksheetPaginationBar({
  pageIndex,
  pageSize,
  totalRows,
  readyCount,
  readyLabel = "ready",
  colCount,
  onPageChange,
  onPageSizeChange,
}: {
  pageIndex: number;
  pageSize: number;
  totalRows: number;
  readyCount: number;
  readyLabel?: string;
  colCount: number;
  onPageChange: (index: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize) || 1);
  const from = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, totalRows);
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < pageCount - 1;

  const pages: (number | "...")[] = [];
  if (pageCount <= 7) {
    for (let i = 0; i < pageCount; i++) pages.push(i);
  } else {
    pages.push(0);
    if (pageIndex > 2) pages.push("...");
    for (
      let i = Math.max(1, pageIndex - 1);
      i <= Math.min(pageCount - 2, pageIndex + 1);
      i++
    ) {
      pages.push(i);
    }
    if (pageIndex < pageCount - 3) pages.push("...");
    pages.push(pageCount - 1);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3 py-1.5">
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>
          Showing{" "}
          <span className="font-semibold text-foreground">
            {from}–{to}
          </span>{" "}
          of{" "}
          <span className="font-semibold text-foreground">
            {totalRows.toLocaleString()}
          </span>{" "}
          rows
        </span>
        {readyCount > 0 && (
          <span className="text-green-600">
            {readyCount} {readyLabel}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(0)}
          disabled={!canPrev}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          title="First page"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(pageIndex - 1)}
          disabled={!canPrev}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          title="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {pageCount > 1 &&
          pages.map((p, idx) =>
            p === "..." ? (
              <span
                key={`ellipsis-${idx}`}
                className="px-0.5 text-[10px] text-muted-foreground/50"
              >
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                className={`flex h-6 min-w-[24px] items-center justify-center rounded px-1 text-[10px] font-medium transition-colors ${
                  pageIndex === p
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {p + 1}
              </button>
            )
          )}
        <button
          type="button"
          onClick={() => onPageChange(pageIndex + 1)}
          disabled={!canNext}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          title="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(pageCount - 1)}
          disabled={!canNext}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          title="Last page"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-6 cursor-pointer appearance-none rounded border bg-background px-1 pr-5 text-[10px] font-medium outline-none focus:ring-1 focus:ring-primary/50"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")",
              backgroundPosition: "right 2px center",
              backgroundRepeat: "no-repeat",
              backgroundSize: "16px",
            }}
          >
            {[25, 50, 100, 250, 500].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
        <span className="opacity-60">{colCount} cols</span>
      </div>
    </div>
  );
}

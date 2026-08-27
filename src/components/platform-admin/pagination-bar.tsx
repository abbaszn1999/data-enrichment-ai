import { Button } from "@/components/ui/button";

export function PaginationBar({
  page,
  pageCount,
  onPage,
  total,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  total: number;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        {total} rows · page {page} of {pageCount}
      </span>
      <div className="flex gap-1">
        <Button type="button" variant="outline" size="xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function paginate<T>(rows: T[], page: number, pageSize = 12): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function pageCount(total: number, pageSize = 12): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

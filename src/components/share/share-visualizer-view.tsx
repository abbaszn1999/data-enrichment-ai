"use client";

/** Read-only Visualizer sheet for a public share link: all columns,
 * pagination, image gallery, full description viewer — no edit capability. */
import { useMemo, useState } from "react";
import { WorksheetPaginationBar } from "@/components/worksheet-pagination-bar";
import { ColumnFilterButton } from "@/components/sheet/column-filter-popover";
import { CellText, CellTextDialog, htmlToPlainText, looksLikeHtml } from "@/components/sheet/cell-text-dialog";
import { ImageLightbox } from "@/components/share/image-lightbox";
import { applyColumnLayout } from "@/lib/sheet/column-layout";
import {
  applyColumnFilters,
  bucketFilterValues,
  columnFilterValues,
  hasActiveFilters,
  setColumnFilter,
  type ColumnFilters,
} from "@/lib/sheet/column-filters";
import type { ColumnLayout } from "@/lib/sheet/column-layout";

interface ShareVisualizerRow {
  id: string;
  rowIndex: number;
  originalData: Record<string, string>;
  generatedDescription?: string;
  imagePlaceholders?: Array<{ index: number; storagePath?: string | null }>;
}

export interface VisualizerSharePayload {
  resourceType: "visualizer";
  name: string;
  columns: string[];
  rows: ShareVisualizerRow[];
  productImageColumn: string | null;
  columnLayout?: ColumnLayout;
  signedUrls: Record<string, string>;
}

const RESULT_DESCRIPTION = "\u0000visualizer:description";
const RESULT_IMAGES = "\u0000visualizer:images";

function resolveSrc(path: string, signedUrls: Record<string, string>): string | null {
  if (/^https?:\/\//i.test(path)) return path;
  return signedUrls[path] ?? null;
}

function columnLabel(column: string): string {
  if (column === RESULT_DESCRIPTION) return "AI Description";
  if (column === RESULT_IMAGES) return "Generated Images";
  return column;
}

function visualizerColumnFilterValue(row: ShareVisualizerRow, column: string): string {
  if (column === RESULT_DESCRIPTION) {
    return row.generatedDescription?.trim() ? "has_description" : "no_description";
  }
  if (column === RESULT_IMAGES) {
    const hasImage = (row.imagePlaceholders ?? []).some((p) => !!p.storagePath);
    return hasImage ? "has_images" : "no_images";
  }
  return row.originalData[column] || "";
}
const DESCRIPTION_BUCKETS = [
  { value: "has_description", label: "Has description" },
  { value: "no_description", label: "Not generated" },
];
const IMAGE_BUCKETS = [
  { value: "has_images", label: "Has images" },
  { value: "no_images", label: "No images yet" },
];

function ImageCell({ paths, signedUrls }: { paths: string[]; signedUrls: Record<string, string> }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const resolved = paths.map((p) => resolveSrc(p, signedUrls)).filter((s): s is string => !!s);
  if (resolved.length === 0) {
    return <span className="text-[11px] text-muted-foreground/40">Not generated</span>;
  }
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {resolved.slice(0, 4).map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt="Generated"
            onClick={() => setLightboxIndex(i)}
            className="h-12 w-12 cursor-pointer rounded border object-cover transition-opacity hover:opacity-80"
          />
        ))}
        {resolved.length > 4 && (
          <button
            onClick={() => setLightboxIndex(4)}
            className="flex h-12 w-12 items-center justify-center rounded border text-[10px] text-muted-foreground hover:bg-muted"
          >
            +{resolved.length - 4}
          </button>
        )}
      </div>
      {lightboxIndex !== null && (
        <ImageLightbox
          images={resolved}
          startIndex={lightboxIndex}
          title="Generated image"
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

export function ShareVisualizerView({ payload }: { payload: VisualizerSharePayload }) {
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [textDialog, setTextDialog] = useState<{ title: string; value: string } | null>(null);

  const naturalColumns = useMemo(() => {
    const productImage =
      payload.productImageColumn && payload.columns.includes(payload.productImageColumn)
        ? payload.productImageColumn
        : null;
    return [
      RESULT_DESCRIPTION,
      RESULT_IMAGES,
      ...(productImage ? [productImage] : []),
      ...payload.columns.filter((c) => c !== productImage),
    ];
  }, [payload.columns, payload.productImageColumn]);
  const displayColumns = useMemo(
    () => applyColumnLayout(naturalColumns, payload.columnLayout),
    [naturalColumns, payload.columnLayout]
  );

  const visibleRows = useMemo(() => {
    if (!hasActiveFilters(columnFilters)) return payload.rows;
    return applyColumnFilters(payload.rows, columnFilters, visualizerColumnFilterValue);
  }, [payload.rows, columnFilters]);

  const pageRows = useMemo(
    () => visibleRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    [visibleRows, pageIndex, pageSize]
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="sticky top-0 z-10 border-b bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-12 bg-muted px-2 py-3 text-center">#</th>
              {displayColumns.map((column) => (
                <th key={column} className="group/dragcol relative truncate bg-muted px-3 py-3">
                  <span className="inline-flex items-center gap-1">
                    <span className="truncate">{columnLabel(column)}</span>
                    <ColumnFilterButton
                      options={
                        column === RESULT_DESCRIPTION
                          ? bucketFilterValues(payload.rows, DESCRIPTION_BUCKETS, (r) =>
                              visualizerColumnFilterValue(r, column)
                            )
                          : column === RESULT_IMAGES
                            ? bucketFilterValues(payload.rows, IMAGE_BUCKETS, (r) =>
                                visualizerColumnFilterValue(r, column)
                              )
                            : columnFilterValues(payload.rows, (r) => visualizerColumnFilterValue(r, column))
                      }
                      active={columnFilters[column]}
                      onApply={(values) => setColumnFilters((prev) => setColumnFilter(prev, column, values))}
                    />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={displayColumns.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                  {payload.rows.length === 0 ? "No rows in this worksheet." : "No products match the current filters."}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const imagePaths = (row.imagePlaceholders ?? [])
                  .map((p) => p.storagePath)
                  .filter((p): p is string => !!p);
                return (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-2 py-2 text-center align-top font-mono text-[10px] text-muted-foreground/60">
                      {row.rowIndex + 1}
                    </td>
                    {displayColumns.map((column) => (
                      <td key={column} className="px-3 py-2 align-top">
                        {column === RESULT_DESCRIPTION ? (
                          row.generatedDescription?.trim() ? (
                            <button
                              type="button"
                              onClick={() =>
                                setTextDialog({ title: "AI Description", value: row.generatedDescription || "" })
                              }
                              className="block max-h-16 w-full overflow-hidden text-left leading-snug hover:underline"
                            >
                              {looksLikeHtml(row.generatedDescription)
                                ? htmlToPlainText(row.generatedDescription)
                                : row.generatedDescription}
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/40">Not generated</span>
                          )
                        ) : column === RESULT_IMAGES ? (
                          <ImageCell paths={imagePaths} signedUrls={payload.signedUrls} />
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setTextDialog({ title: columnLabel(column), value: row.originalData[column] || "" })
                            }
                            className="block max-h-16 w-full overflow-hidden text-left leading-snug hover:underline"
                          >
                            <CellText text={row.originalData[column] || ""} />
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <WorksheetPaginationBar
        pageIndex={pageIndex}
        pageSize={pageSize}
        totalRows={visibleRows.length}
        readyCount={0}
        colCount={displayColumns.length + 1}
        itemLabel="products"
        onPageChange={setPageIndex}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPageIndex(0);
        }}
      />
      {textDialog && (
        <CellTextDialog
          title={textDialog.title}
          value={textDialog.value}
          isEditable={false}
          onClose={() => setTextDialog(null)}
        />
      )}
    </div>
  );
}

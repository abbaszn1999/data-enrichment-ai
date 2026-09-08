"use client";

import { Suspense } from "react";
import {
  Sparkles,
  Play,
  CheckCircle2,
  Loader2,
  Columns3,
  ChevronDown,
  ArrowLeft,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const ROWS = [
  {
    sku: "00LP-DELL-5520",
    brand: "Dell",
    original: "Dell Lat 5520 15.6in i7 16GB",
    title: "Dell Latitude 5520 15.6\" Business Laptop — Intel i7, 16GB RAM",
    desc: "Professional-grade laptop with Intel Core i7, 16GB RAM, and 512GB SSD.",
    status: "done" as const,
  },
  {
    sku: "00PH-SAM-S24U",
    brand: "Samsung",
    original: "Galaxy S24 Ultra 512GB Titanium",
    title: "Samsung Galaxy S24 Ultra 512GB — Titanium Gray, Unlocked",
    desc: "Flagship smartphone with 200MP camera, S Pen, and Galaxy AI features.",
    status: "done" as const,
  },
  {
    sku: "LP-MSI-RAID17",
    brand: "MSI",
    original: "MSI Raider GE78 17in RTX4090",
    title: "MSI Raider GE78 HX — 17\" Gaming Laptop, RTX 4090",
    desc: "",
    status: "processing" as const,
  },
  {
    sku: "PH-ONE-12PRO",
    brand: "OnePlus",
    original: "OnePlus 12 Pro 256GB",
    title: "",
    desc: "",
    status: "pending" as const,
  },
];

export default function DemoEnrichPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <DemoEnrichPage />
    </Suspense>
  );
}

function DemoEnrichPage() {
  const params = useSearchParams();
  const done = params.get("state") === "done";

  const displayRows = done
    ? ROWS.map((r) => ({
        ...r,
        status: "done" as const,
        title: r.title || `${r.brand} ${r.original} — Premium Edition`,
        desc: r.desc || "AI-generated marketing description with SEO keywords and feature highlights.",
      }))
    : ROWS;

  const doneCount = displayRows.filter((r) => r.status === "done").length;
  const progress = Math.round((doneCount / displayRows.length) * 100);

  return (
    <div className="flex h-[calc(100vh-48px)] overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-72 border-r bg-muted/20 flex flex-col shrink-0">
        <div className="p-3 border-b flex items-center gap-2">
          <Link href="/demo/import/session" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold truncate">Samsung Q3 Shipment</div>
            <div className="text-[10px] text-muted-foreground">samsung_q3_shipment.xlsx</div>
          </div>
        </div>

        <div className="p-3 space-y-3 flex-1 overflow-auto">
          <div className="rounded-lg border bg-background p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">Progress</span>
              <Badge variant="secondary" className="text-[9px]">{doneCount}/{displayRows.length}</Badge>
            </div>
            <Progress value={progress} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground">
              {done ? "All rows enriched" : "AI researching products and writing content…"}
            </p>
          </div>

          <div className="rounded-lg border bg-background p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Columns3 className="h-3.5 w-3.5 text-primary" />
              Enrichment Columns
            </div>
            {["Enhanced Title", "Marketing Description", "Categories", "Source URL"].map((col) => (
              <div key={col} className="flex items-center gap-2 text-[11px]">
                <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                <span>{col}</span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border bg-background p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Settings2 className="h-3.5 w-3.5" />
              Model
            </div>
            <button className="w-full flex items-center justify-between text-[11px] px-2 py-1.5 rounded-md border bg-muted/30">
              Gemini 2.5 Flash
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="p-3 border-t space-y-2">
          <Button className="w-full gap-2 h-9 text-xs" size="sm">
            {done ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> Export Results
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Enrich 4 Rows
              </>
            )}
          </Button>
          {!done && (
            <Button variant="outline" className="w-full gap-2 h-8 text-[11px]" size="sm" disabled>
              <Loader2 className="h-3 w-3 animate-spin" /> Processing…
            </Button>
          )}
        </div>
      </aside>

      {/* Spreadsheet */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="border-b px-4 py-2.5 flex items-center justify-between bg-background shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold">Enrichment Spreadsheet</span>
            <Badge variant="outline" className="text-[10px]">{displayRows.length} rows</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-[11px]">Columns</Button>
            <Button size="sm" className="h-7 text-[11px] gap-1">
              <Sparkles className="h-3 w-3" /> Enrich Selected
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-[11px] border-collapse min-w-[1200px]">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
              <tr className="border-b">
                {["SKU", "Brand", "Original Title", "Enhanced Title", "Description", "Status"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr
                  key={row.sku}
                  className={`border-b transition-colors ${
                    row.status === "processing" ? "bg-primary/5" : ""
                  }`}
                >
                  <td className="px-3 py-2.5 font-mono font-medium whitespace-nowrap">{row.sku}</td>
                  <td className="px-3 py-2.5">{row.brand}</td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[200px] truncate">{row.original}</td>
                  <td className="px-3 py-2.5 font-semibold text-primary max-w-[280px]">
                    {row.title || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[240px] truncate">
                    {row.desc || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.status === "done" && (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 text-[9px]">
                        Done
                      </Badge>
                    )}
                    {row.status === "processing" && (
                      <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 text-[9px] gap-1">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Processing
                      </Badge>
                    )}
                    {row.status === "pending" && (
                      <Badge variant="secondary" className="text-[9px]">Pending</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

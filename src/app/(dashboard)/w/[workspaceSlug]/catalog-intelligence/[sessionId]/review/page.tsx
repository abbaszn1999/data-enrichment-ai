"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Sparkles,
  Search,
  X,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/brand/page-loader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getImportSession,
  updateImportSession,
  type ImportSession,
} from "@/lib/supabase";
import { loadProjectJson, loadProductsJson, saveProjectJson, type ProjectRow } from "@/lib/storage-helpers";
import { useWorkspaceContext } from "../../../workspace-context";
import { normalizeValue, generateDiff, type MatchingRule } from "@/lib/matching";
import { applyMatchTypes, resolveTargetCategoryNames } from "@/lib/import-matching";
import { ImportStepper } from "@/components/catalog-intelligence/import-stepper";
import type { SessionKind } from "@/types";

// Alias ProjectRow for compatibility with existing template code
type ImportRow = ProjectRow & { id: string; match_type?: string | null; supplier_data?: Record<string, string>; diff_data?: Record<string, any>; mapped_data?: Record<string, any> };

export default function ReviewPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const sessionId = params.sessionId as string;
  const { workspace } = useWorkspaceContext();

  const [session, setSession] = useState<ImportSession | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [supplierColumns, setSupplierColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [continueLoading, setContinueLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"existing" | "new">("existing");
  const [searchTerm, setSearchTerm] = useState("");
  const [kind, setKind] = useState<SessionKind>("product");

  const isPlp = kind === "plp";

  useEffect(() => {
    if (!sessionId || !workspace) return;
    Promise.all([
      getImportSession(sessionId),
      loadProjectJson(workspace.id, sessionId),
      loadProductsJson(workspace.id),
    ]).then(async ([s, project, masterProducts]) => {
      setSession(s);

      // Extract supplier columns from project
      if (project?.columns) {
        setSupplierColumns(project.columns);
      }

      const sessionKind: SessionKind =
        (s?.kind as SessionKind) ?? project?.kind ?? "product";
      setKind(sessionKind);

      // Re-run matching client-side so the review never depends on stale storage
      const projectRows = project?.rows ?? [];
      const supplierMatchCol = s?.supplier_match_column || (project?.columns?.[0] ?? "");

      // PLP has no matching step at all — every page is always "new".
      if (sessionKind === "plp") {
        for (const row of projectRows) row.matchType = "new";
      } else if (project?.matchingSkipped) {
        // "Skip matching" is a decision, not a cache — re-deriving would undo it.
        for (const row of projectRows) row.matchType = row.matchType ?? "new";
      } else {
        const matchRules: MatchingRule[] = (s?.matching_rules as MatchingRule[]) || [];
        const masterMatchCol = s?.master_match_column || "sku";

        await applyMatchTypes({
          kind: "product",
          workspaceId: workspace.id,
          rows: projectRows,
          sourceColumn: supplierMatchCol,
          masterColumn: masterMatchCol,
          rules: matchRules,
          targetCategoryNames: await resolveTargetCategoryNames(
            workspace.id,
            s?.target_category_ids
          ),
        });

        const columnMapping: Record<string, string> = {};
        for (const col of (project?.columns ?? [])) { columnMapping[col] = col; }
        const masterMap = new Map(masterProducts.map((p) => [p.sku, p]));

        for (const row of projectRows) {
          const matchedSku = (row as any).matchedProductSku as string | undefined;
          if (!matchedSku) continue;
          const masterProduct = masterMap.get(matchedSku);
          if (masterProduct?.data && row.originalData) {
            (row as any).diffData = generateDiff(
              row.originalData,
              masterProduct.data,
              columnMapping,
              masterMatchCol
            );
          }
        }
      }

      console.log("[Review] Matching — existing:", projectRows.filter(r => r.matchType === "existing").length, "| new:", projectRows.filter(r => r.matchType === "new").length);

      // Convert ProjectRow[] to ImportRow[] for compatibility
      const importRows: ImportRow[] = projectRows.map((r) => ({
        ...r,
        match_type: r.matchType,
        supplier_data: r.originalData,
        diff_data: (r as any).diffData || {},
        mapped_data: r.originalData,
      }));
      setRows(importRows);
      // Auto-select tab with data
      const hasExisting = importRows.some((r) => r.match_type === "existing");
      if (!hasExisting) setActiveTab("new");
      setLoading(false);
    });
  }, [sessionId, workspace]);

  const existingRows = useMemo(() => rows.filter((r) => r.match_type === "existing"), [rows]);
  const newRows = useMemo(() => rows.filter((r) => r.match_type === "new"), [rows]);

  const handleContinue = async () => {
    if (!session || !workspace) return;
    setContinueLoading(true);

    try {
      // Save the matched project JSON back to Storage so Enrich page sees correct matchType
      const project = await loadProjectJson(workspace.id, session.id);
      if (project) {
        // Apply match results from local state to project rows
        const rowMap = new Map(rows.map((r) => [r.id, r]));
        for (const row of project.rows) {
          const matched = rowMap.get(row.id);
          if (matched) {
            row.matchType = matched.match_type as any || row.matchType;
            if ((matched as any).matchedProductSku) {
              (row as any).matchedProductSku = (matched as any).matchedProductSku;
            }
            if (matched.diff_data && Object.keys(matched.diff_data).length > 0) {
              (row as any).diffData = matched.diff_data;
            }
          }
        }
        await saveProjectJson(workspace.id, session.id, project);
      }

      await updateImportSession(session.id, {
        status: "enriching",
      } as any);

      router.push(`/w/${slug}/catalog-intelligence/${session.id}`);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || err?.error_description || JSON.stringify(err);
      alert(msg || "Failed to continue");
      setContinueLoading(false);
    }
  };

  const filteredExisting = useMemo(() => {
    if (!searchTerm) return existingRows;
    const s = searchTerm.toLowerCase();
    return existingRows.filter((r) =>
      Object.values(r.mapped_data || {}).some((v) => String(v).toLowerCase().includes(s))
    );
  }, [existingRows, searchTerm]);

  const filteredNew = useMemo(() => {
    if (!searchTerm) return newRows;
    const s = searchTerm.toLowerCase();
    return newRows.filter((r) =>
      Object.values(r.mapped_data || {}).some((v) => String(v).toLowerCase().includes(s))
    );
  }, [newRows, searchTerm]);

  if (loading) {
    return <PageLoader />;
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-muted-foreground">Session not found</p>
        <Button variant="outline" size="sm" onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      <section className="border-b border-border/60 bg-gradient-to-r from-[#400095]/[0.07] via-background to-[#F76D01]/[0.07]">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex max-w-[1500px] items-center gap-3 px-5 py-6 sm:px-7 lg:px-10">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="mb-1 text-[9px] font-black uppercase tracking-[.2em] text-[#400095] dark:text-[#F76D01]">Step 03 · Quality review</div>
          <h1 className="text-2xl font-black tracking-tight">{session.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {isPlp
              ? "Check which category pages you are updating and which you are creating before enrichment."
              : "Inspect matches, identify updates, and verify new products before enrichment."}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl border-border/60 bg-background/70 text-xs">
          <Download className="h-3.5 w-3.5" /> Export Report
        </Button>
      </motion.div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-5 p-5 sm:p-7 lg:p-10">
      <section className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm"><ImportStepper currentStep={isPlp ? 2 : 3} kind={kind} /></section>

      {/* Tabs — PLP has no "existing" concept, so it always shows one unified table */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:flex-row sm:items-center">
        {!isPlp && (
          <div className="flex gap-1 rounded-xl bg-muted/50 p-1">
            <button
              onClick={() => setActiveTab("existing")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "existing" ? "bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]" : "text-muted-foreground hover:bg-background"
              }`}
            >
              Existing ({existingRows.length})
            </button>
            <button
              onClick={() => setActiveTab("new")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === "new" ? "bg-[#400095] text-white shadow-sm dark:bg-[#F76D01]" : "text-muted-foreground hover:bg-background"
              }`}
            >
              New ({newRows.length})
            </button>
          </div>
        )}
        {isPlp && (
          <div className="text-xs font-medium text-muted-foreground">
            {rows.length} {rows.length === 1 ? "page" : "pages"} ready for enrichment
          </div>
        )}
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 w-full rounded-xl border border-border/60 bg-muted/35 pl-8 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-[#6B358D]/40 sm:w-56"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Existing Products Table */}
      {!isPlp && activeTab === "existing" && (
        <Card className="overflow-hidden rounded-[24px] border-border/60 shadow-[0_15px_50px_rgba(15,23,42,.05)]">
          <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
          <div className="overflow-x-auto max-h-[calc(100vh-400px)]">
            <table className="w-max min-w-full">
              <thead className="sticky top-0 z-20">
                <tr className="border-b bg-card/95 backdrop-blur-xl">
                  {supplierColumns.map((col) => (
                    <th key={col} className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase whitespace-nowrap min-w-[120px]">{col}</th>
                  ))}
                  {/* PLP rows are matched by identity only, so there is no field-level diff to show. */}
                  {!isPlp && (
                    <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase min-w-[100px]">Changes</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredExisting.length === 0 ? (
                  <tr><td colSpan={supplierColumns.length + (isPlp ? 0 : 1)} className="text-center py-8 text-xs text-muted-foreground">No matching rows</td></tr>
                ) : (
                  filteredExisting.map((row) => {
                    const d = row.mapped_data || {};
                    const diff = row.diff_data || {};
                    const diffFields = Object.keys(diff);
                    return (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20">
                        {supplierColumns.map((col) => {
                          const hasDiff = diff[col];
                          return (
                            <td key={col} className={`px-3 py-2.5 text-xs whitespace-nowrap max-w-[250px] truncate ${hasDiff ? "bg-amber-50/50 dark:bg-amber-950/10 font-medium" : ""}`}>
                              {d[col] ?? "—"}
                              {hasDiff && (
                                <span className="text-[9px] text-muted-foreground ml-1">(was: {hasDiff.old})</span>
                              )}
                            </td>
                          );
                        })}
                        {!isPlp && (
                        <td className="px-3 py-2.5 text-center">
                          {diffFields.length > 0 ? (
                            <Badge variant="secondary" className="text-[8px] bg-amber-50 text-amber-700 dark:bg-amber-950/30">
                              {diffFields.length} changed
                            </Badge>
                          ) : (
                            <span className="text-[9px] text-muted-foreground">No changes</span>
                          )}
                        </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* New Products Table — for PLP this is the single unified table of all pages */}
      {(isPlp || activeTab === "new") && (
        <Card className="overflow-hidden rounded-[24px] border-border/60 shadow-[0_15px_50px_rgba(15,23,42,.05)]">
          <div className="h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
          <div className="overflow-x-auto max-h-[calc(100vh-400px)]">
            <table className="w-max min-w-full">
              <thead className="sticky top-0 z-20">
                <tr className="border-b bg-card/95 backdrop-blur-xl">
                  {supplierColumns.map((col) => (
                    <th key={col} className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase whitespace-nowrap min-w-[120px]">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredNew.length === 0 ? (
                  <tr><td colSpan={supplierColumns.length} className="text-center py-8 text-xs text-muted-foreground">{isPlp ? "No pages" : "No new products"}</td></tr>
                ) : (
                  filteredNew.map((row) => {
                    const d = row.mapped_data || {};
                    return (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20">
                        {supplierColumns.map((col) => (
                          <td key={col} className="px-3 py-2.5 text-xs whitespace-nowrap max-w-[250px] truncate">{d[col] ?? "—"}</td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-muted-foreground">
          {isPlp
            ? `${rows.length} total`
            : `${existingRows.length} existing, ${newRows.length} new — ${rows.length} total`}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => router.back()}>Back</Button>
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-xl bg-[#400095] px-4 text-xs text-white hover:bg-[#6B358D] dark:bg-[#F76D01]"
            onClick={handleContinue}
            disabled={continueLoading}
          >
            {continueLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {continueLoading ? "Opening Enrichment Tool..." : "Continue to Enrichment Tool"}
          </Button>
        </div>
      </div>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getImportSession,
  updateImportSession,
  type ImportSession,
} from "@/lib/supabase";
import { loadProjectJson, loadProductsJson, saveProjectJson, type ProjectRow } from "@/lib/storage-helpers";
import { useWorkspaceContext } from "../../../layout";
import { normalizeValue, generateDiff, type MatchingRule } from "@/lib/matching";
import { ImportStepper } from "@/components/import/import-stepper";

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

  useEffect(() => {
    if (!sessionId || !workspace) return;
    Promise.all([
      getImportSession(sessionId),
      loadProjectJson(workspace.id, sessionId),
      loadProductsJson(workspace.id),
    ]).then(([s, project, masterProducts]) => {
      setSession(s);

      // Extract supplier columns from project
      if (project?.columns) {
        setSupplierColumns(project.columns);
      }

      // Re-run matching client-side using session rules (bulletproof, no Storage cache dependency)
      const matchRules: MatchingRule[] = (s?.matching_rules as MatchingRule[]) || [];
      const supplierMatchCol = s?.supplier_match_column || (project?.columns?.[0] ?? "");
      const masterMatchCol = s?.master_match_column || "sku";
      const columnMapping: Record<string, string> = {};
      for (const col of (project?.columns ?? [])) { columnMapping[col] = col; }

      // Build master keys — same proven logic as Rules page preview
      const masterKeys = new Map<string, string>(); // normalized → original sku
      for (const p of masterProducts) {
        const val = masterMatchCol === "sku" ? p.sku : (p.data?.[masterMatchCol] ?? p.sku);
        masterKeys.set(normalizeValue(String(val), matchRules), p.sku);
      }
      const masterMap = new Map(masterProducts.map((p) => [p.sku, p]));

      // Match each row
      const projectRows = project?.rows ?? [];
      for (const row of projectRows) {
        const supplierVal = row.originalData?.[supplierMatchCol] ?? "";
        const normalized = normalizeValue(String(supplierVal), matchRules);
        if (masterKeys.has(normalized)) {
          row.matchType = "existing";
          const matchedSku = masterKeys.get(normalized)!;
          (row as any).matchedProductSku = matchedSku;
          const masterProduct = masterMap.get(matchedSku);
          if (masterProduct?.data && row.originalData) {
            (row as any).diffData = generateDiff(row.originalData, masterProduct.data, columnMapping);
          }
        } else {
          row.matchType = "new";
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

      router.push(`/w/${slug}/import/${session.id}/enrich`);
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
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
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
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{session.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Review matching results</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <Download className="h-3.5 w-3.5" /> Export Report
        </Button>
      </div>

      <ImportStepper currentStep={3} />

      {/* Tabs */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("existing")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "existing" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            Existing ({existingRows.length})
          </button>
          <button
            onClick={() => setActiveTab("new")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "new" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            New ({newRows.length})
          </button>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 w-44 pl-8 pr-7 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Existing Products Table */}
      {activeTab === "existing" && (
        <Card>
          <div className="overflow-x-auto max-h-[calc(100vh-400px)]">
            <table className="w-max min-w-full">
              <thead className="sticky top-0 z-20">
                <tr className="border-b bg-muted/80 backdrop-blur-sm">
                  {supplierColumns.map((col) => (
                    <th key={col} className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase whitespace-nowrap min-w-[120px]">{col}</th>
                  ))}
                  <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase min-w-[100px]">Changes</th>
                </tr>
              </thead>
              <tbody>
                {filteredExisting.length === 0 ? (
                  <tr><td colSpan={supplierColumns.length + 1} className="text-center py-8 text-xs text-muted-foreground">No matching rows</td></tr>
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
                        <td className="px-3 py-2.5 text-center">
                          {diffFields.length > 0 ? (
                            <Badge variant="secondary" className="text-[8px] bg-amber-50 text-amber-700 dark:bg-amber-950/30">
                              {diffFields.length} changed
                            </Badge>
                          ) : (
                            <span className="text-[9px] text-muted-foreground">No changes</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* New Products Table */}
      {activeTab === "new" && (
        <Card>
          <div className="overflow-x-auto max-h-[calc(100vh-400px)]">
            <table className="w-max min-w-full">
              <thead className="sticky top-0 z-20">
                <tr className="border-b bg-muted/80 backdrop-blur-sm">
                  {supplierColumns.map((col) => (
                    <th key={col} className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase whitespace-nowrap min-w-[120px]">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredNew.length === 0 ? (
                  <tr><td colSpan={supplierColumns.length} className="text-center py-8 text-xs text-muted-foreground">No new products</td></tr>
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
          {existingRows.length} existing, {newRows.length} new — {rows.length} total
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => router.back()}>Back</Button>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleContinue}
            disabled={continueLoading}
          >
            {continueLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {continueLoading ? "Opening Enrichment Tool..." : "Continue to Enrichment Tool"}
          </Button>
        </div>
      </div>
    </div>
  );
}

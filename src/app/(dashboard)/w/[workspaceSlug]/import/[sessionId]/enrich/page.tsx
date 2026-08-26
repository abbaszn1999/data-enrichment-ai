"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getImportSession, type ImportSession } from "@/lib/supabase";
import { loadProjectJson, loadProductsJson } from "@/lib/storage-helpers";
import { useWorkspaceContext } from "../../../layout";
import { useSheetStore } from "@/store/sheet-store";
import { normalizeValue, type MatchingRule } from "@/lib/matching";
import { Sidebar } from "@/components/sidebar";
import { DataTable } from "@/components/data-table";
import {
  DEFAULT_ENRICHMENT_COLUMNS,
  DEFAULT_ENRICHMENT_SETTINGS,
  type ProductRow,
} from "@/types";

export default function EnrichPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;
  const { workspace } = useWorkspaceContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const { loadProject, rows, fileName } = useSheetStore();

  useEffect(() => {
    if (!sessionId || !workspace || loadedRef.current) return;
    loadedRef.current = true;

    async function load() {
      try {
        // 1. Get session metadata from DB
        const session = await getImportSession(sessionId);
        if (!session) {
          setError("Session not found");
          setLoading(false);
          return;
        }

        // 2. Load project data from Storage JSON
        const project = await loadProjectJson(workspace!.id, sessionId);
        if (!project) {
          setError("Project data not found in storage");
          setLoading(false);
          return;
        }

        // 3. Re-run matching to ensure matchType is always correct
        const masterProducts = await loadProductsJson(workspace!.id);
        const matchRules: MatchingRule[] = (session.matching_rules as MatchingRule[]) || [];
        const supplierMatchCol = session.supplier_match_column || (project.columns?.[0] ?? "");
        const masterMatchCol = session.master_match_column || "sku";

        const masterKeys = new Map<string, string>();
        for (const p of masterProducts) {
          const val = masterMatchCol === "sku" ? p.sku : (p.data?.[masterMatchCol] ?? p.sku);
          masterKeys.set(normalizeValue(String(val), matchRules), p.sku);
        }

        const containsRule = matchRules.find((r) => r.type === "contains" && r.enabled);

        for (const row of project.rows) {
          const supplierVal = row.originalData?.[supplierMatchCol] ?? "";
          const normalized = normalizeValue(String(supplierVal), matchRules);

          let matched = false;
          if (masterKeys.has(normalized)) {
            matched = true;
          } else if (containsRule) {
            for (const mk of masterKeys.keys()) {
              if (normalized.includes(mk) || mk.includes(normalized)) { matched = true; break; }
            }
          }
          row.matchType = matched ? "existing" : "new";
        }

        // Convert Storage rows to ProductRow[] for the sheet store
        const productRows: ProductRow[] = project.rows.map((r, idx) => ({
          id: r.id,
          rowIndex: r.rowIndex ?? idx,
          selected: true,
          status: r.status as ProductRow["status"],
          errorMessage: r.errorMessage,
          originalData: r.originalData || {},
          enrichedData: r.enrichedData || {},
          matchType: (r.matchType as "existing" | "new" | null) || "new",
        }));

        // 4. Use saved enrichment config from Storage, or defaults
        const enrichCols = project.enrichmentColumns?.length > 0
          ? project.enrichmentColumns
          : DEFAULT_ENRICHMENT_COLUMNS;
        const enrichSettings = project.enrichmentSettings && Object.keys(project.enrichmentSettings).length > 0
          ? project.enrichmentSettings
          : DEFAULT_ENRICHMENT_SETTINGS;

        // 5. Load into the sheet store
        loadProject(
          workspace!.id,
          sessionId,
          session.name || "Catalog Intelligence Session",
          project.columns,
          productRows,
          project.sourceColumns?.length > 0 ? project.sourceColumns : [...project.columns],
          enrichCols,
          enrichSettings,
          project.columnVisibility || {},
        );

        setLoading(false);
      } catch (err: any) {
        console.error("Failed to load enrichment data:", err);
        setError(err?.message || "Failed to load");
        setLoading(false);
      }
    }

    load();
  }, [sessionId, workspace, loadProject]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-xs text-muted-foreground">Loading enrichment tool...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  // Render the original big enrichment tool: Sidebar (left) + DataTable (center)
  return (
    <TooltipProvider>
      <div className="autommerce-dashboard flex h-full min-h-0 flex-col overflow-hidden bg-background [font-family:var(--brand-font)]">
        <div className="h-1 shrink-0 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-background/95 px-3 backdrop-blur-xl">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-lg p-0"
            onClick={() => router.back()}
            aria-label="Back to review"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#400095] text-white dark:bg-[#F76D01]">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-black">{fileName || "Catalog enrichment"}</div>
            <div className="text-[8px] font-bold uppercase tracking-[.16em] text-[#6B358D] dark:text-[#C8A8D2]">
              Step 04 · Enrichment workspace
            </div>
          </div>
          <div className="ml-auto rounded-lg border border-border/60 bg-muted/35 px-2 py-1 text-[9px] text-muted-foreground">
            <strong className="text-foreground">{rows.length}</strong> rows loaded
          </div>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <DataTable />
        </div>
      </div>
    </TooltipProvider>
  );
}

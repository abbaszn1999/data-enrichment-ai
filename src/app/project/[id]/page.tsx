"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { DataTable } from "@/components/data-table";
import { useSheetStore } from "@/store/sheet-store";
import { getProject, getProjectRows } from "@/lib/supabase";
import type { ProductRow, EnrichmentColumn, EnrichmentSettings } from "@/types";
import { DEFAULT_ENRICHMENT_COLUMNS, DEFAULT_ENRICHMENT_SETTINGS } from "@/types";

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { projectId: storeProjectId, loadProject } = useSheetStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If the store already has this project loaded, skip fetching
    if (storeProjectId === projectId) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const project = await getProject(projectId);
        if (!project) {
          setError("Project not found");
          return;
        }

        const dbRows = await getProjectRows(projectId);

        // Convert DB rows to ProductRow format
        const rows: ProductRow[] = dbRows.map((r) => ({
          id: r.id, // Use the DB UUID as the row id
          dbId: r.id,
          rowIndex: r.row_index,
          selected: true,
          status: (r.status === "processing" ? "pending" : r.status) as ProductRow["status"],
          errorMessage: r.error_message || undefined,
          originalData: r.original_data,
          enrichedData: r.enriched_data || {},
        }));

        // Parse enrichment columns with defaults
        const enrichmentColumns: EnrichmentColumn[] =
          (project.enrichment_columns as EnrichmentColumn[])?.length > 0
            ? (project.enrichment_columns as EnrichmentColumn[])
            : DEFAULT_ENRICHMENT_COLUMNS.map((c) => ({ ...c, enabled: true }));

        const enrichmentSettings: EnrichmentSettings =
          project.enrichment_settings && Object.keys(project.enrichment_settings).length > 0
            ? (project.enrichment_settings as EnrichmentSettings)
            : DEFAULT_ENRICHMENT_SETTINGS;

        const sourceColumns: string[] =
          (project.source_columns as string[])?.length > 0
            ? (project.source_columns as string[])
            : (project.original_columns as string[]);

        const columnVisibility: Record<string, boolean> =
          (project.column_visibility as Record<string, boolean>) || {};

        loadProject(
          projectId,
          project.file_name,
          project.original_columns as string[],
          rows,
          sourceColumns,
          enrichmentColumns,
          enrichmentSettings,
          columnVisibility
        );
      } catch (err) {
        console.error("Failed to load project:", err);
        setError("Failed to load project");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [projectId, storeProjectId, loadProject]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading project...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-destructive font-medium">{error}</p>
          <button
            onClick={() => router.push("/projects")}
            className="text-sm text-primary hover:underline"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <DataTable />
      </div>
    </div>
  );
}

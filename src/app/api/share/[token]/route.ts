import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { resolveShareToken } from "@/lib/share/links";
import { hideProviderNames } from "@/lib/provider-names";
import { sanitizeShareView } from "@/lib/share/view";
import { loadProjectJsonAdmin } from "@/lib/jobs/project-json";
import { resolveProductGroupColumn } from "@/lib/catalog/product-groups";
import { getDefaultEnrichmentColumns, type ProductRow, type SessionKind } from "@/types";
import { loadGalleryWorksheetAdmin } from "@/lib/gallery/storage-admin";
import { signGalleryWorksheetImages } from "@/lib/gallery/signed-urls";
import { loadVisualizerWorksheetAdmin, signVisualizerWorksheetImages } from "@/lib/visualizer/storage-admin";
import { resolveVisualizerHtmlImages } from "@/lib/visualizer/html-embed";
import { parseGalleryProjectSettings } from "@/lib/gallery/settings-schema";
import { applyGalleryProjectSettings } from "@/lib/gallery/types";
import { parseVisualizerProjectSettings } from "@/lib/visualizer/settings-schema";
import { applyVisualizerProjectSettings } from "@/lib/visualizer/types";

type Ctx = { params: Promise<{ token: string }> };

function withStoredSettings<W, S>(
  worksheet: W,
  raw: unknown,
  parse: (raw: unknown) => S,
  apply: (worksheet: W, settings: S) => W
): W {
  if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) return worksheet;
  try {
    return apply(worksheet, parse(raw));
  } catch {
    return worksheet;
  }
}

/**
 * Public, unauthenticated read-only sheet data for a live share link. Never
 * exposes anything beyond what the resource's own admin view already shows,
 * and never includes the AI model identifier (enrichmentSettings) — the
 * read-only view has no re-enrichment action to justify sending it.
 */
export async function GET(request: NextRequest, context: Ctx) {
  const { token } = await context.params;
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const admin = createAdminClient();
  const link = await resolveShareToken(admin, token);
  if (!link) {
    return NextResponse.json({ error: "This share link is invalid or has been turned off" }, { status: 404 });
  }

  // The owner's filters and sort at the time they shared; the page opens on them.
  const view = sanitizeShareView(link.view);

  try {
    if (link.resource_type === "catalog") {
      const { data: session } = await admin
        .from("catalog_sessions")
        .select("name, kind")
        .eq("id", link.resource_id)
        .eq("workspace_id", link.workspace_id)
        .maybeSingle();
      const project = await loadProjectJsonAdmin(link.workspace_id, link.resource_id, admin);
      if (!project) {
        return NextResponse.json({ error: "This project no longer exists" }, { status: 404 });
      }
      const kind: SessionKind = (session?.kind as SessionKind) ?? project.kind ?? "product";
      const productRows: ProductRow[] = project.rows.map((r, idx) => ({
        id: r.id,
        rowIndex: r.rowIndex ?? idx,
        selected: false,
        status: r.status as ProductRow["status"],
        errorMessage: hideProviderNames(r.errorMessage),
        originalData: r.originalData || {},
        enrichedData: r.enrichedData || {},
        matchType: (r.matchType as "existing" | "new" | null) || "new",
      }));
      const enrichmentColumns =
        project.enrichmentColumns?.length > 0 ? project.enrichmentColumns : getDefaultEnrichmentColumns(kind);
      const productGroupColumn = resolveProductGroupColumn({
        saved: project.productGroupColumn,
        columns: project.columns,
        rows: productRows,
        kind,
      });
      return NextResponse.json({
        resourceType: "catalog",
        workspaceId: link.workspace_id,
        resourceId: link.resource_id,
        name: session?.name || "Catalog Intelligence Session",
        kind,
        columns: project.columns,
        rows: productRows,
        sourceColumns: project.sourceColumns?.length > 0 ? project.sourceColumns : [...project.columns],
        enrichmentColumns,
        columnVisibility: project.columnVisibility || {},
        columnLayout: project.columnLayout,
        matchingSkipped: project.matchingSkipped ?? false,
        productGroupColumn,
        view,
      });
    }

    if (link.resource_type === "gallery") {
      const { data: session } = await admin
        .from("gallery_sessions")
        .select("name, settings")
        .eq("id", link.resource_id)
        .eq("workspace_id", link.workspace_id)
        .maybeSingle();
      const stored = await loadGalleryWorksheetAdmin(link.workspace_id, link.resource_id);
      if (!stored) {
        return NextResponse.json({ error: "This project no longer exists" }, { status: 404 });
      }
      // Settings autosave into the session row, so they are fresher than the worksheet file.
      const worksheet = withStoredSettings(stored, session?.settings, parseGalleryProjectSettings, applyGalleryProjectSettings);
      const signedUrls = await signGalleryWorksheetImages(worksheet);
      return NextResponse.json({
        resourceType: "gallery",
        name: session?.name || "Product Gallery Session",
        columns: worksheet.columns,
        rows: worksheet.rows,
        originalImageColumn: worksheet.originalImageColumn,
        originalImageSelectionExplicit: worksheet.originalImageSelectionExplicit ?? false,
        selectedColumns: worksheet.selectedColumns,
        columnLayout: worksheet.columnLayout,
        signedUrls,
        view,
      });
    }

    if (link.resource_type === "visualizer") {
      const { data: session } = await admin
        .from("visualizer_sessions")
        .select("name, settings")
        .eq("id", link.resource_id)
        .eq("workspace_id", link.workspace_id)
        .maybeSingle();
      const stored = await loadVisualizerWorksheetAdmin(link.workspace_id, link.resource_id);
      if (!stored) {
        return NextResponse.json({ error: "This project no longer exists" }, { status: 404 });
      }
      const worksheet = withStoredSettings(stored, session?.settings, parseVisualizerProjectSettings, applyVisualizerProjectSettings);
      const signedUrls = await signVisualizerWorksheetImages(worksheet);
      const rows = worksheet.rows.map((row) => ({
        ...row,
        generatedDescription: row.generatedDescription
          ? resolveVisualizerHtmlImages(row.generatedDescription, signedUrls)
          : row.generatedDescription,
      }));
      return NextResponse.json({
        resourceType: "visualizer",
        name: session?.name || "Visualizer Session",
        columns: worksheet.columns,
        rows,
        productImageColumn: worksheet.settings.productImageColumn,
        columnLayout: worksheet.settings.columnLayout,
        signedUrls,
        view,
      });
    }

    return NextResponse.json({ error: "Unknown resource type" }, { status: 400 });
  } catch (error) {
    console.error("[share/token] Error:", error);
    return NextResponse.json({ error: "Failed to load shared sheet" }, { status: 500 });
  }
}

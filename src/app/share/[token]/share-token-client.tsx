"use client";

/**
 * Public, read-only view for a live share link. No sidebar, no login — the
 * root layout is the only thing wrapping this page. Refetches periodically so
 * Gallery/Visualizer signed image URLs (short-lived) never expire mid-view.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, Loader2 } from "lucide-react";
import { DataTable } from "@/components/data-table";
import { useSheetStore } from "@/store/sheet-store";
import { ShareGalleryView, type GallerySharePayload } from "@/components/share/share-gallery-view";
import { ShareVisualizerView, type VisualizerSharePayload } from "@/components/share/share-visualizer-view";
import {
  DEFAULT_ENRICHMENT_SETTINGS,
  getDefaultEnrichmentColumns,
  type ProductRow,
  type SessionKind,
} from "@/types";

// Refetch well before the 1h signed-image-URL expiry so an open share view
// never shows a broken image mid-session.
const REFRESH_INTERVAL_MS = 45 * 60 * 1000;

interface CatalogSharePayload {
  resourceType: "catalog";
  workspaceId: string;
  resourceId: string;
  name: string;
  kind: SessionKind;
  columns: string[];
  rows: ProductRow[];
  sourceColumns: string[];
  enrichmentColumns: ReturnType<typeof getDefaultEnrichmentColumns>;
  columnVisibility: Record<string, boolean>;
  columnLayout?: { order: string[]; hidden: string[] };
  matchingSkipped?: boolean;
  productGroupColumn?: string | null;
}

type SharePayload = CatalogSharePayload | GallerySharePayload | VisualizerSharePayload;

function CatalogShareView({ payload }: { payload: CatalogSharePayload }) {
  const loadProject = useSheetStore((s) => s.loadProject);
  const loadedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    // Re-run on every fresh payload (each 45-minute refetch) so edits made by
    // the owner in the meantime show up, not just on first mount.
    const signature = JSON.stringify(payload.rows.map((r) => [r.id, r.status]));
    if (loadedSignatureRef.current === signature) return;
    loadedSignatureRef.current = signature;
    loadProject(
      // Deliberately empty, not `payload.workspaceId`/`payload.resourceId`:
      // the store's module-level autosave subscription only fires when both
      // are truthy, so this keeps a share view from ever writing back to the
      // owner's project in Storage.
      "",
      "",
      payload.name,
      payload.columns,
      payload.rows,
      payload.sourceColumns,
      payload.enrichmentColumns,
      DEFAULT_ENRICHMENT_SETTINGS,
      payload.columnVisibility,
      payload.kind,
      payload.matchingSkipped,
      payload.productGroupColumn,
      payload.columnLayout
    );
  }, [payload, loadProject]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DataTable readOnly />
    </div>
  );
}

export function ShareTokenClient({ token }: { token: string }) {
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/share/${token}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error || "This share link is invalid or has been turned off");
          setLoading(false);
          return;
        }
        const data = (await res.json()) as SharePayload;
        setPayload(data);
        setError(null);
      } catch {
        if (!cancelled) setError("Could not load this shared sheet. Check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  if (loading && !payload) {
    return (
      <div className="flex h-screen items-center justify-center bg-muted/20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-muted/20 px-4 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">{error}</p>
        <p className="text-xs text-muted-foreground">
          Ask whoever sent you this link to share it again.
        </p>
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Image src="/autommerce-natural.png" alt="" width={20} height={20} className="rounded" />
          <span className="truncate text-sm font-semibold">{payload.name}</span>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          View only
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {payload.resourceType === "catalog" && <CatalogShareView payload={payload} />}
        {payload.resourceType === "gallery" && (
          <div className="h-full p-4">
            <ShareGalleryView payload={payload} />
          </div>
        )}
        {payload.resourceType === "visualizer" && (
          <div className="h-full p-4">
            <ShareVisualizerView payload={payload} />
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchAnalyticsProperties, saveAnalyticsProperty } from "@/hooks/use-analytics";
import type { AnalyticsConnectionType, AnalyticsPropertyOption } from "@/lib/analytics/types";

function PropertyRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/3 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-8 w-16 shrink-0 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/**
 * Popup property picker for GSC / GA4. Opened explicitly by AnalyticsShell
 * (right after OAuth return, when the status says a property is still
 * needed, or from a manual "Choose/Change property" button) — it no longer
 * renders itself inline on the page.
 */
export function AnalyticsPropertyPicker({
  open,
  onOpenChange,
  workspaceId,
  type,
  title,
  hasExistingProperty,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  type: AnalyticsConnectionType;
  title: string;
  hasExistingProperty: boolean;
  onSaved: (property: AnalyticsPropertyOption) => void;
}) {
  const [properties, setProperties] = useState<AnalyticsPropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the "Refresh list" button to re-run the fetch effect below;
  // forceNextLoad marks that specific re-run as a cache-busting reload
  // without affecting the normal "fetch once per dialog open" behavior.
  const [reloadNonce, setReloadNonce] = useState(0);
  const forceNextLoad = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const force = forceNextLoad.current;
    forceNextLoad.current = false;
    setLoading(true);
    setError(null);
    fetchAnalyticsProperties(workspaceId, type, force)
      .then((rows) => {
        if (!cancelled) setProperties(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to list properties");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, type, workspaceId, reloadNonce]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a {title} property</DialogTitle>
          <DialogDescription>
            {hasExistingProperty
              ? `Pick a different ${title} property. This replaces the one currently connected.`
              : `Pick which ${title} property this workspace should pull data from.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          {loading ? (
            <>
              <PropertyRowSkeleton />
              <PropertyRowSkeleton />
              <PropertyRowSkeleton />
            </>
          ) : error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : properties.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No properties were returned for this Google account.
            </p>
          ) : (
            properties.map((property) => (
              <div
                key={property.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{property.label}</p>
                  {property.detail ? (
                    <p className="truncate text-[11px] text-muted-foreground">{property.detail}</p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  disabled={saving !== null}
                  onClick={async () => {
                    setSaving(property.id);
                    setError(null);
                    try {
                      await saveAnalyticsProperty(workspaceId, type, property.id, {
                        label: property.label,
                        detail: property.detail,
                      });
                      onSaved(property);
                      onOpenChange(false);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to save property");
                    } finally {
                      setSaving(null);
                    }
                  }}
                >
                  {saving === property.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Use this"
                  )}
                </Button>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs"
            disabled={loading || saving !== null}
            onClick={() => {
              forceNextLoad.current = true;
              setReloadNonce((n) => n + 1);
            }}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh list
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving !== null}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

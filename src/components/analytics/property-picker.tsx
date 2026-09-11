"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchAnalyticsProperties, saveAnalyticsProperty } from "@/hooks/use-analytics";
import type { AnalyticsConnectionType, AnalyticsPropertyOption } from "@/lib/analytics/types";

export function AnalyticsPropertyPicker({
  workspaceId,
  type,
  title,
  onSaved,
}: {
  workspaceId: string;
  type: AnalyticsConnectionType;
  title: string;
  onSaved: () => void;
}) {
  const [properties, setProperties] = useState<AnalyticsPropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAnalyticsProperties(workspaceId, type)
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
  }, [type, workspaceId]);

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <h3 className="text-sm font-bold">Choose a {title} property</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        This is locked after you pick it. Disconnect and reconnect to change it later.
      </p>
      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading properties…
        </div>
      ) : error ? (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      ) : properties.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No properties were returned for this Google account.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {properties.map((property) => (
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
                  try {
                    await saveAnalyticsProperty(workspaceId, type, property.id, {
                      label: property.label,
                      detail: property.detail,
                    });
                    onSaved();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to save property");
                  } finally {
                    setSaving(null);
                  }
                }}
              >
                {saving === property.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Use this"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

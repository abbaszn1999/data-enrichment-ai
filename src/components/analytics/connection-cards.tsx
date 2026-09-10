"use client";

import { BarChart3, Globe, Loader2, PlugZap, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AnalyticsConnectionPublic, AnalyticsConnectionType, AnalyticsStatus } from "@/lib/analytics/types";

export function AnalyticsConnectionCards({
  status,
  loading,
  canManage,
  workspaceId,
  slug,
  busyType,
  onDisconnect,
}: {
  status: AnalyticsStatus;
  loading: boolean;
  canManage: boolean;
  workspaceId: string;
  slug: string;
  busyType: AnalyticsConnectionType | null;
  onDisconnect: (type: AnalyticsConnectionType) => void;
}) {
  const start = (type: AnalyticsConnectionType) => {
    window.location.href = `/api/analytics/oauth/start?workspaceId=${encodeURIComponent(workspaceId)}&type=${type}&slug=${encodeURIComponent(slug)}`;
  };

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-24 animate-pulse rounded-2xl border border-border/60 bg-card" />
        <div className="h-24 animate-pulse rounded-2xl border border-border/60 bg-card" />
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ConnectionCard
        title="Google Search Console"
        icon={Globe}
        connection={status.gsc}
        configured={status.configured}
        canManage={canManage}
        busy={busyType === "search-console"}
        onConnect={() => start("search-console")}
        onDisconnect={() => onDisconnect("search-console")}
      />
      <ConnectionCard
        title="Google Analytics 4"
        icon={BarChart3}
        connection={status.ga4}
        configured={status.configured}
        canManage={canManage}
        busy={busyType === "google-analytics"}
        onConnect={() => start("google-analytics")}
        onDisconnect={() => onDisconnect("google-analytics")}
      />
    </div>
  );
}

function ConnectionCard({
  title,
  icon: Icon,
  connection,
  configured,
  canManage,
  busy,
  onConnect,
  onDisconnect,
}: {
  title: string;
  icon: typeof Globe;
  connection: AnalyticsConnectionPublic;
  configured: boolean;
  canManage: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            connection.connected ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
          }`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {connection.connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {connection.connected
              ? connection.propertyLabel || connection.email || "Property not selected"
              : configured
                ? "Connect to pull live performance"
                : "Google OAuth is not configured on this server"}
          </p>
        </div>
      </div>
      {canManage && (
        connection.connected ? (
          <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs" disabled={busy} onClick={onDisconnect}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
            Disconnect
          </Button>
        ) : (
          <Button size="sm" className="h-8 shrink-0 text-xs" disabled={!configured || busy} onClick={onConnect}>
            <PlugZap className="mr-1.5 h-3.5 w-3.5" />
            Connect
          </Button>
        )
      )}
    </div>
  );
}

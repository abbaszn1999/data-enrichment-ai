"use client";

import { useEffect, useState } from "react";
import { PageLoader } from "@/components/brand/page-loader";
import { LiveBadge, PageTitle } from "@/components/platform-admin/list-chrome";
import { PageHeader } from "@/components/platform-admin/page-header";
import { adminJson } from "@/lib/platform-admin/client-api";
import { formatDateTime, formatDuration } from "@/lib/platform-admin/format";
import { cn } from "@/lib/utils";

type Payload = {
  window: string;
  totals: {
    runs: number;
    workspaces: number;
    chats: number;
    storeChanges: number;
    credits: number;
    usd: number;
    avgDurationMs: number | null;
    cacheHitRatio: number | null;
  };
  byStatus: Record<string, number>;
  byModel: Array<{ model: string; runs: number; credits: number; usd: number; inputTokens: number; cacheReadTokens: number; outputTokens: number; errors: number }>;
  problems: Array<{ id: string; status: string; error: string | null; model: string; workspace: string; startedAt: string }>;
};

const WINDOWS = ["24h", "7d", "30d"] as const;
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function AdminStoreAgentPage() {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>("7d");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    adminJson<Payload>(`/api/platform-admin/store-agent?window=${window}`, { signal: controller.signal })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [window]);

  if (!data && !error) return <PageLoader />;

  const t = data?.totals;
  const failed = (data?.byStatus.error ?? 0) + (data?.byStatus.interrupted ?? 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title={<PageTitle label="Store Agent" badge={t ? <LiveBadge>{t.runs} runs</LiveBadge> : undefined} />}
        description="Runs, failures and model cost of the Cursor-powered Store Agent. Cost is Cursor's published rates, charged to customers 1:1 (10 credits = $1)."
        actions={
          <div className="flex rounded-lg border p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindow(w)}
                className={cn("rounded-md px-3 py-1 text-xs font-medium", w === window ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {w}
              </button>
            ))}
          </div>
        }
      />
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {t && data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Runs" value={t.runs.toLocaleString()} hint={`${t.workspaces} workspaces · ${t.chats} active chats`} />
            <Stat label="Charged" value={`${t.credits.toFixed(1)} credits`} hint={`$${t.usd.toFixed(2)} model cost`} />
            <Stat
              label="Failures"
              value={`${failed}`}
              hint={t.runs ? `${((failed / t.runs) * 100).toFixed(1)}% of runs · ${data.byStatus.cancelled ?? 0} stopped by users` : undefined}
            />
            <Stat
              label="Avg duration"
              value={formatDuration(t.avgDurationMs)}
              hint={`${t.storeChanges} store changes · cache ${t.cacheHitRatio === null ? "—" : `${Math.round(t.cacheHitRatio * 100)}%`}`}
            />
          </div>

          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">Runs</th>
                  <th className="px-3 py-2 text-right font-medium">Errors</th>
                  <th className="px-3 py-2 text-right font-medium">Input</th>
                  <th className="px-3 py-2 text-right font-medium">Cached</th>
                  <th className="px-3 py-2 text-right font-medium">Output</th>
                  <th className="px-3 py-2 text-right font-medium">Credits</th>
                  <th className="px-3 py-2 text-right font-medium">Avg / run</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map((m) => (
                  <tr key={m.model} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{m.model}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.runs}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", m.errors && "text-destructive")}>{m.errors}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{tokens(m.inputTokens)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.inputTokens ? `${Math.round((m.cacheReadTokens / m.inputTokens) * 100)}%` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{tokens(m.outputTokens)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.credits.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(m.credits / Math.max(1, m.runs)).toFixed(3)}</td>
                  </tr>
                ))}
                {!data.byModel.length && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      No runs in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Recent failures</h2>
            <div className="divide-y rounded-xl border">
              {data.problems.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">No failures in this window.</div>}
              {data.problems.map((p) => (
                <div key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", p.status === "error" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700")}>{p.status}</span>
                  <span className="font-medium">{p.workspace}</span>
                  <span className="font-mono text-xs text-muted-foreground">{p.model}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(p.startedAt)}</span>
                  {p.error && <span className="w-full text-xs text-muted-foreground">{p.error}</span>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

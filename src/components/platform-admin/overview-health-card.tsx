import { OverviewCard, OverviewPanelHeader } from "@/components/platform-admin/overview-card";
import { formatCredits } from "@/lib/platform-admin/format";
import type { OverviewJobHealth } from "@/lib/platform-admin/live-types";
import type { AdminSpendSlice } from "@/lib/platform-admin/types";
import { cn } from "@/lib/utils";

function HealthRing({ percent }: { percent: number | null }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const shown = percent ?? 0;
  const offset = c - (shown / 100) * c;
  return (
    <div className="relative size-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="size-full -rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" className="stroke-muted" strokeWidth="7" />
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={percent == null ? c : offset}
          className="stroke-[#400095] dark:stroke-[#F76D01]"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
        {percent == null ? "—" : `${percent.toFixed(0)}%`}
      </span>
    </div>
  );
}

export function OverviewHealthCard({
  health,
  slices,
  attentionCount,
}: {
  health: OverviewJobHealth;
  slices: AdminSpendSlice[];
  attentionCount: number;
}) {
  const decided = health.completed + health.failed;
  const rate = decided === 0 ? null : (health.completed / decided) * 100;
  const top = slices.slice(0, 4);
  const max = Math.max(...top.map((slice) => slice.value), 1);

  return (
    <OverviewCard className="flex h-full min-h-[340px] flex-col">
      <OverviewPanelHeader title="Job health" hint="Completed vs failed in this range" />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-4">
          <HealthRing percent={rate} />
          <div className="min-w-0 space-y-1.5 text-xs">
            <p className="text-muted-foreground">
              {decided === 0
                ? "No completed or failed jobs in this range."
                : `${health.completed} completed · ${health.failed} failed`}
            </p>
            <p className="text-muted-foreground">{health.running} running / queued</p>
            <p
              className={cn(
                attentionCount ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
              )}
            >
              {attentionCount ? `${attentionCount} need attention` : "Nothing needs attention"}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Top credit ops
          </p>
          {top.length === 0 ? (
            <p className="text-sm text-muted-foreground">No credit spend in this range.</p>
          ) : (
            <ul className="space-y-2.5">
              {top.map((slice) => (
                <li key={slice.key}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">{slice.label}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatCredits(slice.value)}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[#400095] dark:bg-[#F76D01]"
                      style={{ width: `${Math.max(6, (slice.value / max) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </OverviewCard>
  );
}

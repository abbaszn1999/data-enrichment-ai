"use client";

// Small building blocks shared by the Google Ads screens.

import { type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AD_STRENGTH } from "@/lib/google-ads/constants";
import type { AdPolicyStatus, AdStrength, EntityStatus } from "@/lib/google-ads/types";

/** Brand accent for primary actions. */
export const ACCENT_BTN =
  "bg-[#400095] text-white hover:bg-[#33007a] dark:bg-violet-600 dark:hover:bg-violet-500 disabled:opacity-50";

export const STATUS_META: Record<EntityStatus, { label: string; dot: string }> = {
  ENABLED: { label: "Enabled", dot: "bg-emerald-500" },
  PAUSED: { label: "Paused", dot: "bg-zinc-400 dark:bg-zinc-500" },
  REMOVED: { label: "Removed", dot: "bg-red-500" },
};

export function StatusDot({ status, className }: { status: EntityStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background",
        STATUS_META[status].dot,
        status === "PAUSED" && "rounded-[3px]",
        className
      )}
      aria-label={STATUS_META[status].label}
    />
  );
}

/** Status dot that opens Enable / Pause / Remove, like Google Ads tables. */
export function StatusMenu({
  status,
  onChange,
  disabled,
}: {
  status: EntityStatus;
  onChange: (status: EntityStatus) => void;
  disabled?: boolean;
}) {
  if (disabled || status === "REMOVED") return <StatusDot status={status} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Status: ${STATUS_META[status].label}`}
      >
        <StatusDot status={status} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36" onClick={(e) => e.stopPropagation()}>
        {(["ENABLED", "PAUSED", "REMOVED"] as EntityStatus[]).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => s !== status && onChange(s)} className="gap-2 text-xs">
            <StatusDot status={s} />
            {s === "ENABLED" ? "Enable" : s === "PAUSED" ? "Pause" : "Remove"}
            {s === status && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info" | "brand";
  className?: string;
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    bad: "bg-red-500/10 text-red-700 dark:text-red-400",
    info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    brand: "bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

export function PolicyPill({ policy }: { policy: AdPolicyStatus }) {
  const map: Record<AdPolicyStatus, { label: string; tone: "good" | "warn" | "bad" | "info" }> = {
    APPROVED: { label: "Eligible", tone: "good" },
    APPROVED_LIMITED: { label: "Eligible (limited)", tone: "warn" },
    DISAPPROVED: { label: "Disapproved", tone: "bad" },
    UNDER_REVIEW: { label: "Under review", tone: "info" },
  };
  return <Pill tone={map[policy].tone}>{map[policy].label}</Pill>;
}

export function AdStrengthMeter({ strength, compact }: { strength: AdStrength; compact?: boolean }) {
  const meta = AD_STRENGTH[strength];
  const colors = ["bg-red-500", "bg-amber-500", "bg-sky-500", "bg-emerald-500"];
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-1.5 rounded-full", compact ? "w-2" : "w-3", i <= meta.score ? colors[meta.score - 1] : "bg-muted")} />
        ))}
      </span>
      <span className={cn("text-[11px] font-semibold", meta.tone)}>{meta.label}</span>
    </span>
  );
}

export function Delta({ value, higherIsBetter = true, className }: { value: number | null; higherIsBetter?: boolean; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className={cn("text-[10px] text-muted-foreground", className)}>—</span>;
  const up = value >= 0;
  const good = up === higherIsBetter;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold", Math.abs(value) < 0.005 ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400", className)}>
      <Icon className="h-3 w-3" />
      {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-[#400095] dark:bg-violet-600" : "bg-muted-foreground/25"
      )}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

export function Checkbox({ checked, onChange, indeterminate, label }: { checked: boolean; onChange: (v: boolean) => void; indeterminate?: boolean; label?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate;
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-[#400095] dark:accent-violet-500"
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "sm",
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  size?: "xs" | "sm";
}) {
  return (
    <div className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
            size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SelectBox<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function Field({ label, hint, children, error, counter }: { label: string; hint?: ReactNode; children: ReactNode; error?: string; counter?: { used: number; max: number } }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        {counter && (
          <span className={cn("text-[10px] tabular-nums", counter.used > counter.max ? "text-red-600" : "text-muted-foreground")}>
            {counter.used}/{counter.max}
          </span>
        )}
      </span>
      {children}
      {hint && !error && <span className="block text-[11px] leading-relaxed text-muted-foreground">{hint}</span>}
      {error && <span className="block text-[11px] text-red-600">{error}</span>}
    </label>
  );
}

/** Text input with a live character counter against a Google Ads limit. */
export function LimitedInput({
  value,
  onChange,
  max,
  placeholder,
  className,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  max: number;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
}) {
  const over = value.length > max;
  const base =
    "w-full rounded-md border bg-background px-3 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";
  return (
    <div className={cn("relative", className)}>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={cn(base, "resize-none py-2 pr-14", over ? "border-red-500" : "border-input")}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(base, "h-9 pr-14", over ? "border-red-500" : "border-input")}
        />
      )}
      <span className={cn("pointer-events-none absolute right-2.5 top-2.5 text-[10px] tabular-nums", over ? "font-semibold text-red-600" : "text-muted-foreground")}>
        {value.length}/{max}
      </span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 px-6 py-14 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ViewHeader({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-black tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-border/60 bg-card shadow-sm", className)}>{children}</div>;
}

/** Placeholder tile for images until real assets come from the media library. */
export function ImageTile({ label, ratio = "square", className }: { label: string; ratio?: "square" | "landscape" | "portrait"; className?: string }) {
  const hue = [...label].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={cn(
        "relative flex items-end overflow-hidden rounded-lg text-[9px] font-semibold text-white/90",
        ratio === "square" ? "aspect-square" : ratio === "landscape" ? "aspect-[1.91/1]" : "aspect-[4/5]",
        className
      )}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 50) % 360} 75% 30%))` }}
    >
      <span className="m-1.5 truncate rounded bg-black/25 px-1 py-0.5 backdrop-blur-sm">{label}</span>
    </div>
  );
}

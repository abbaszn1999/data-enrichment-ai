import { Badge } from "@/components/ui/badge";
import {
  JOB_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  USER_STATUS_LABELS,
} from "@/lib/platform-admin/labels";
import { cn } from "@/lib/utils";
import type {
  AdminIntegrationStatus,
  AdminJobStatus,
  AdminSubscriptionStatus,
  AdminUserStatus,
} from "@/lib/platform-admin/types";

const toneClass: Record<string, string> = {
  ok: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  mute: "border-border bg-muted/80 text-muted-foreground",
  info: "border-[#6B358D]/20 bg-[#400095]/10 text-[#6B358D] dark:border-[#F76D01]/25 dark:bg-[#F76D01]/10 dark:text-[#F76D01]",
};

function pill(label: string, tone: keyof typeof toneClass) {
  return (
    <Badge
      variant="outline"
      className={cn("h-5 px-2 text-[11px] font-medium capitalize tracking-normal", toneClass[tone])}
    >
      {label}
    </Badge>
  );
}

export function SubscriptionStatusBadge({ status }: { status: AdminSubscriptionStatus }) {
  const tone =
    status === "active" || status === "trialing"
      ? "ok"
      : status === "past_due" || status === "incomplete"
        ? "warn"
        : "mute";
  return pill(SUBSCRIPTION_STATUS_LABELS[status] ?? status, tone);
}

export function JobStatusBadge({ status }: { status: AdminJobStatus }) {
  const tone =
    status === "completed"
      ? "ok"
      : status === "running" || status === "queued"
        ? "info"
        : status === "failed" || status === "paused_no_credits"
          ? "danger"
          : "mute";
  return pill(JOB_STATUS_LABELS[status] ?? status, tone);
}

export function UserStatusBadge({ status }: { status: AdminUserStatus }) {
  const tone = status === "active" ? "ok" : status === "invited" ? "info" : "mute";
  return pill(USER_STATUS_LABELS[status], tone);
}

export function IntegrationStatusBadge({ status }: { status: AdminIntegrationStatus | "none" }) {
  if (status === "none") return pill("None", "mute");
  const tone = status === "connected" ? "ok" : status === "error" ? "danger" : "mute";
  return pill(status, tone);
}

export function PlanBadge({ name }: { name: string }) {
  return pill(name, "info");
}

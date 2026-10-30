"use client";

import { useState } from "react";
import { AlertOctagon, AlertTriangle, Bell, Bot, CheckCheck, Info, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { Alert, AutomatedRule, RuleMetric } from "@/lib/google-ads/types";
import { Card, EmptyState, Pill, Segmented, Toggle, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const METRIC_LABEL: Record<RuleMetric, string> = {
  cost: "Cost",
  conversions: "Conversions",
  cpa: "Cost / conversion",
  roas: "ROAS (×)",
  ctr: "CTR (%)",
  clicks: "Clicks",
  budgetSpent: "Budget spent (%)",
};

const ACTION_LABEL: Record<AutomatedRule["action"], string> = {
  NOTIFY: "Send me an alert",
  PAUSE_CAMPAIGN: "Pause the campaign",
  PAUSE_KEYWORDS: "Pause matching keywords",
  RAISE_BUDGET: "Raise budget by",
  LOWER_BUDGET: "Lower budget by",
};

const WINDOW_LABEL = { TODAY: "today", LAST_7_DAYS: "in the last 7 days", LAST_30_DAYS: "in the last 30 days" } as const;

function ago(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function describeRule(r: AutomatedRule, campaignNames: (ids: string[]) => string) {
  return `When ${METRIC_LABEL[r.condition.metric].toLowerCase()} ${r.condition.op === ">" ? "is above" : "is below"} ${r.condition.value} ${WINDOW_LABEL[r.condition.window]} on ${campaignNames(r.campaignIds)} → ${ACTION_LABEL[r.action].toLowerCase()}${r.amount ? ` ${r.amount}%` : ""}. Checked ${r.frequency.toLowerCase()}.`;
}

export function RulesView() {
  const { data } = useGa();
  const [tab, setTab] = useState<"alerts" | "rules">("alerts");
  const unread = data.alerts.filter((a) => !a.read).length;
  return (
    <div>
      <ViewHeader
        title="Rules & alerts"
        subtitle="The agent watches the account around the clock. Rules act on their own; alerts tell you what happened."
        actions={
          <button type="button" onClick={() => runAgentTurn("Set up monitoring and alerts for my account")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
            <Bot className="h-3.5 w-3.5" /> Let the agent set it up
          </button>
        }
      >
        <Segmented
          value={tab}
          onChange={setTab}
          size="xs"
          options={[
            { value: "alerts", label: "Alerts", count: unread },
            { value: "rules", label: "Automated rules", count: data.rules.length },
          ]}
        />
      </ViewHeader>
      {tab === "alerts" ? <AlertsFeed /> : <RulesList />}
    </div>
  );
}

const SEVERITY: Record<Alert["severity"], { icon: typeof Info; tone: string }> = {
  CRITICAL: { icon: AlertOctagon, tone: "bg-red-500/10 text-red-600" },
  WARNING: { icon: AlertTriangle, tone: "bg-amber-500/10 text-amber-600" },
  INFO: { icon: Info, tone: "bg-sky-500/10 text-sky-600" },
};

export function AlertsFeed({ compact }: { compact?: boolean }) {
  const { data } = useGa();
  const markAlertsRead = useGoogleAds((s) => s.markAlertsRead);
  const setScope = useGoogleAds((s) => s.setScope);
  const alerts = [...data.alerts].sort((a, b) => b.at.localeCompare(a.at));
  if (!alerts.length) return <EmptyState icon={Bell} title="No alerts" body="When a rule fires or something needs attention, it shows up here." />;
  return (
    <div className="space-y-2">
      {!compact && alerts.some((a) => !a.read) && (
        <button type="button" onClick={() => markAlertsRead()} className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
          <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
        </button>
      )}
      {alerts.map((a) => {
        const sev = SEVERITY[a.severity];
        return (
          <Card key={a.id} className={cn("flex gap-3 p-3.5", a.read && "opacity-70")}>
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", sev.tone)}>
              <sev.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-xs font-semibold">
                {!a.read && <span className="h-1.5 w-1.5 rounded-full bg-[#F76D01]" />}
                {a.title}
                <span className="ml-auto shrink-0 text-[10px] font-normal text-muted-foreground">{ago(a.at)}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{a.body}</p>
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] font-semibold">
                {a.prompt && (
                  <button type="button" onClick={() => { markAlertsRead([a.id]); runAgentTurn(a.prompt!); }} className="inline-flex items-center gap-1 text-[#400095] hover:underline dark:text-violet-300">
                    <Bot className="h-3 w-3" /> Ask the agent
                  </button>
                )}
                {a.campaignId && (
                  <button type="button" onClick={() => { markAlertsRead([a.id]); setScope({ campaignId: a.campaignId }, "overview"); }} className="text-muted-foreground hover:text-foreground">
                    Open campaign
                  </button>
                )}
                {!a.read && (
                  <button type="button" onClick={() => markAlertsRead([a.id])} className="text-muted-foreground hover:text-foreground">
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function RulesList() {
  const { data } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const names = (ids: string[]) => (ids.length ? ids.map((id) => data.campaigns.find((c) => c.id === id)?.name ?? id).join(", ") : "all enabled campaigns");

  return (
    <div className="space-y-3">
      {data.rules.map((r) => (
        <Card key={r.id} className={cn("p-4", !r.enabled && "opacity-70")}>
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300">
              <Zap className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                {r.name}
                <Pill tone={r.createdBy === "AGENT" ? "brand" : "neutral"}>{r.createdBy === "AGENT" ? "Set up by agent" : "Yours"}</Pill>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{describeRule(r, names)}</p>
              {r.lastRun && <p className="mt-1 text-[11px] text-muted-foreground">Last run {ago(r.lastRun)}: <span className="text-foreground">{r.lastResult}</span></p>}
            </div>
            <Toggle checked={r.enabled} label="Rule enabled" onChange={(v) => applyDirect(`${v ? "Enable" : "Disable"} rule "${r.name}"`, [{ kind: "collection.upsert", collection: "rules", items: [{ ...r, enabled: v }] }])} />
            <button type="button" onClick={() => applyDirect(`Delete rule "${r.name}"`, [{ kind: "collection.remove", collection: "rules", ids: [r.id] }])} className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-600" aria-label="Delete rule">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </Card>
      ))}
      {!data.rules.length && <EmptyState icon={Zap} title="No automated rules" body="Ask the agent to set up a rule, e.g. pause campaigns that overspend." />}
    </div>
  );
}

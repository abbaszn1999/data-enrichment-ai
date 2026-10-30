"use client";

import { useState } from "react";
import { AlertOctagon, AlertTriangle, Bell, Bot, CheckCheck, Info, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { gid } from "@/lib/google-ads/mutations";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { Alert, AutomatedRule, RuleMetric } from "@/lib/google-ads/types";
import { Input } from "@/components/ui/input";
import { ACCENT_BTN, Card, EmptyState, Field, Pill, Segmented, SelectBox, Toggle, ViewHeader } from "../ga-ui";
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
  const [creating, setCreating] = useState(false);
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
      {creating ? (
        <RuleForm onDone={() => setCreating(false)} />
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-semibold hover:bg-muted">
          <Plus className="h-3.5 w-3.5" /> New rule
        </button>
      )}
    </div>
  );
}

function RuleForm({ onDone }: { onDone: () => void }) {
  const { data } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [rule, setRule] = useState<AutomatedRule>({
    id: gid("rule"),
    name: "",
    campaignIds: [],
    condition: { metric: "cost", op: ">", value: 100, window: "TODAY" },
    action: "NOTIFY",
    frequency: "DAILY",
    enabled: true,
    createdBy: "USER",
  });
  const set = (patch: Partial<AutomatedRule>) => setRule((r) => ({ ...r, ...patch }));
  const cond = (patch: Partial<AutomatedRule["condition"]>) => setRule((r) => ({ ...r, condition: { ...r.condition, ...patch } }));
  const needsAmount = rule.action === "RAISE_BUDGET" || rule.action === "LOWER_BUDGET";

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-bold">New rule</p>
      <Field label="Name">
        <Input value={rule.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Pause campaigns that overspend" />
      </Field>
      <Field label="Apply to">
        <SelectBox
          value={rule.campaignIds[0] ?? "ALL"}
          onChange={(v) => set({ campaignIds: v === "ALL" ? [] : [v] })}
          options={[{ value: "ALL", label: "All enabled campaigns" }, ...data.campaigns.filter((c) => c.status !== "REMOVED").map((c) => ({ value: c.id, label: c.name }))]}
        />
      </Field>
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="When">
          <SelectBox value={rule.condition.metric} onChange={(v) => cond({ metric: v })} options={(Object.keys(METRIC_LABEL) as RuleMetric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
        </Field>
        <Field label="Is">
          <SelectBox value={rule.condition.op} onChange={(v) => cond({ op: v })} options={[{ value: ">", label: "above" }, { value: "<", label: "below" }]} />
        </Field>
        <Field label="Value">
          <Input type="number" value={rule.condition.value} onChange={(e) => cond({ value: Number(e.target.value) })} />
        </Field>
        <Field label="Over">
          <SelectBox value={rule.condition.window} onChange={(v) => cond({ window: v })} options={[{ value: "TODAY", label: "Today" }, { value: "LAST_7_DAYS", label: "Last 7 days" }, { value: "LAST_30_DAYS", label: "Last 30 days" }]} />
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Then">
          <SelectBox value={rule.action} onChange={(v) => set({ action: v })} options={(Object.keys(ACTION_LABEL) as AutomatedRule["action"][]).map((a) => ({ value: a, label: ACTION_LABEL[a] }))} />
        </Field>
        {needsAmount && (
          <Field label="By (%)">
            <Input type="number" value={rule.amount ?? 20} onChange={(e) => set({ amount: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Check">
          <SelectBox value={rule.frequency} onChange={(v) => set({ frequency: v })} options={[{ value: "HOURLY", label: "Every hour" }, { value: "DAILY", label: "Every day" }, { value: "WEEKLY", label: "Every week" }]} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-muted">Cancel</button>
        <button
          type="button"
          disabled={!rule.name.trim()}
          onClick={() => {
            const item = needsAmount ? { ...rule, amount: rule.amount ?? 20 } : rule;
            const res = applyDirect(`Create rule "${rule.name}"`, [{ kind: "collection.upsert", collection: "rules", items: [item] }]);
            if (res.ok) {
              toast.success("Rule created");
              onDone();
            }
          }}
          className={cn("rounded-lg px-3 py-1.5 text-xs font-semibold", ACCENT_BTN)}
        >
          Create rule
        </button>
      </div>
    </Card>
  );
}

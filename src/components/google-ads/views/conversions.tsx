"use client";

import { useState } from "react";
import { Bot, Code2, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CONVERSION_CATEGORIES } from "@/lib/google-ads/constants";
import { money, num } from "@/lib/google-ads/metrics";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { ConversionAction } from "@/lib/google-ads/types";
import { GaTable, type GaColumn } from "../ga-table";
import { Card, Pill, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const STATUS: Record<ConversionAction["status"], { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  ACTIVE: { label: "Recording conversions", tone: "good" },
  NO_RECENT_CONVERSIONS: { label: "No recent conversions", tone: "warn" },
  UNVERIFIED: { label: "Unverified", tone: "bad" },
  REMOVED: { label: "Removed", tone: "neutral" },
};

export function tagSnippet(account: string, action: ConversionAction) {
  const label = action.id.replace(/[^a-z0-9]/gi, "").slice(0, 12).toUpperCase();
  return `<!-- Google tag (gtag.js) — add once to every page -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-${account}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'AW-${account}');
</script>

<!-- Event snippet: ${action.name} — fire on the ${action.category === "PURCHASE" ? "order confirmation" : "conversion"} page -->
<script>
  gtag('event', 'conversion', {
    'send_to': 'AW-${account}/${label}',${action.useDynamicValue ? "\n    'value': ORDER_TOTAL,\n    'currency': 'USD',\n    'transaction_id': ORDER_ID" : action.defaultValue ? `\n    'value': ${action.defaultValue},\n    'currency': 'USD'` : ""}
  });
</script>`;
}

export function ConversionsView() {
  const { data, currency } = useGa();
  const actions = data.conversions.filter((c) => c.status !== "REMOVED");
  const [tagFor, setTagFor] = useState<string | null>(null);
  const tagAction = actions.find((a) => a.id === tagFor);

  const columns: GaColumn<ConversionAction>[] = [
    {
      id: "name",
      header: "Conversion action",
      sortValue: (c) => c.name,
      render: (c) => (
        <span>
          <span className="block font-semibold">{c.name}</span>
          <span className="text-[10px] text-muted-foreground">{CONVERSION_CATEGORIES[c.category]} · {c.source.replace(/_/g, " ").toLowerCase()}</span>
        </span>
      ),
    },
    {
      id: "goal",
      header: "Optimization",
      render: (c) => (
        <Pill tone={c.primary ? "brand" : "neutral"}>{c.primary ? "Primary" : "Secondary"}</Pill>
      ),
    },
    { id: "status", header: "Status", render: (c) => <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill> },
    {
      id: "value",
      header: "Value",
      render: (c) => <span className="text-muted-foreground">{c.useDynamicValue ? "Transaction-specific" : c.defaultValue ? money(c.defaultValue, currency) : "None"}</span>,
    },
    { id: "count", header: "Count", render: (c) => <span className="text-muted-foreground">{c.countingType === "ONE_PER_CLICK" ? "One" : "Every"}</span> },
    { id: "window", header: "Click window", align: "right", render: (c) => `${c.clickThroughWindowDays} days` },
    { id: "attribution", header: "Attribution", render: (c) => <span className="text-muted-foreground">{c.attribution === "DATA_DRIVEN" ? "Data-driven" : "Last click"}</span> },
    { id: "conv", header: "Conv. (30d)", align: "right", sortValue: (c) => c.conversions30d, render: (c) => <span className="font-semibold">{num(c.conversions30d)}</span> },
    {
      id: "tag",
      header: "",
      align: "right",
      render: (c) =>
        c.source === "WEBSITE" ? (
          <button type="button" onClick={() => setTagFor(tagFor === c.id ? null : c.id)} className={cn("inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] hover:bg-muted", tagFor === c.id && "bg-muted")}>
            <Code2 className="h-3 w-3" /> Tag
          </button>
        ) : null,
    },
  ];

  const primary = actions.filter((a) => a.primary);
  return (
    <div className="space-y-4">
      <ViewHeader
        title="Conversions"
        subtitle="What counts as success. Bidding optimises for primary actions only; secondary actions are reported but not bid on."
        actions={
          <>
            <button type="button" onClick={() => runAgentTurn("Check my conversion tracking")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
              <Bot className="h-3.5 w-3.5" /> Check tracking
            </button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-muted-foreground">Primary goals</p>
          <p className="mt-1 text-sm font-bold">{primary.map((p) => p.name).join(", ") || "None set"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-muted-foreground">Tracking issues</p>
          <p className={cn("mt-1 text-sm font-bold", actions.some((a) => a.status !== "ACTIVE") ? "text-amber-600" : "text-emerald-600")}>
            {actions.filter((a) => a.status !== "ACTIVE").length || "None"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold text-muted-foreground">Auto-tagging (GCLID)</p>
          <p className="mt-1 text-sm font-bold">{data.account.autoTagging ? "On" : "Off"}</p>
        </Card>
      </div>
      <GaTable rows={actions} columns={columns} rowKey={(c) => c.id} />
      {tagAction && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold">Tag setup · {tagAction.name}</p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(tagSnippet(data.account.customerId, tagAction));
                toast.success("Tag copied");
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] hover:bg-muted"
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">{tagSnippet(data.account.customerId, tagAction)}</pre>
          <p className="mt-2 text-[11px] text-muted-foreground">On Shopify, WooCommerce and Magento we can install this through the store integration instead.</p>
        </Card>
      )}
      <AdvancedMeasurement />
    </div>
  );
}

function AdvancedMeasurement() {
  const { data } = useGa();
  const setView = useGoogleAds((s) => s.setView);
  const ga4 = data.links.find((l) => l.kind === "GA4");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <p className="text-sm font-bold">Measurement settings</p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-semibold">Enhanced conversions</p>
            <p className="text-[11px] text-muted-foreground">Hashed customer data from checkout recovers conversions lost to browsers and cookies (typically +5%).</p>
          </div>
          <Pill tone={data.account.enhancedConversions ? "good" : "neutral"}>{data.account.enhancedConversions ? "On" : "Off"}</Pill>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-semibold">Google Analytics 4</p>
            <p className="text-[11px] text-muted-foreground">{ga4?.status === "LINKED" ? `Linked: ${ga4.name}. GA4 key events can be imported as conversions.` : "Not linked. Link GA4 to import its key events and audiences."}</p>
          </div>
          <button type="button" onClick={() => setView("links")} className="rounded-lg border border-border/70 px-2.5 py-1 text-[11px] font-semibold hover:bg-muted">
            View
          </button>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-bold">Conversion value rules</p>
        <p className="mb-3 text-[11px] text-muted-foreground">Tell bidding that some conversions are worth more, e.g. VIP customers or a city with bigger baskets. To add or change a rule, ask the agent.</p>
        {data.valueRules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-b border-border/40 py-2 text-xs last:border-b-0">
            <span className="flex-1">
              If <span className="font-semibold">{r.condition.kind.toLowerCase()}</span> is <span className="font-semibold">{r.condition.value}</span>, adjust value by{" "}
              <span className="font-semibold text-emerald-600">+{Math.round(r.adjustment * 100)}%</span>
            </span>
            <Pill tone={r.enabled ? "good" : "neutral"}>{r.enabled ? "Enabled" : "Disabled"}</Pill>
          </div>
        ))}
        {!data.valueRules.length && <p className="text-xs text-muted-foreground">No value rules yet.</p>}
      </Card>

      <Card className="p-4 lg:col-span-2">
        <p className="text-sm font-bold">Offline conversions</p>
        <p className="mb-3 text-[11px] text-muted-foreground">Sales that happened outside the site (phone orders, store pickups), matched to ad clicks so Google credits the right ads. To import a file, send it to the agent.</p>
        {data.offlineImports.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-2 border-t border-border/40 py-2 text-xs">
            <span className="font-semibold">{i.fileName}</span>
            <span className="text-muted-foreground">{new Date(i.at).toLocaleDateString()} · {i.matched}/{i.rows} matched ({Math.round((i.matched / i.rows) * 100)}%)</span>
            <Pill tone={i.status === "PROCESSED" ? "good" : i.status === "FAILED" ? "bad" : "info"} className="ml-auto">{i.status.toLowerCase()}</Pill>
          </div>
        ))}
        {!data.offlineImports.length && <p className="text-xs text-muted-foreground">No offline imports yet.</p>}
      </Card>
    </div>
  );
}
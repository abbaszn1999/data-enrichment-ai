"use client";

import { useState } from "react";
import { BarChart3, Link2, MonitorPlay, Search, ShieldCheck, ShoppingBag, Store, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCustomerId } from "@/lib/google-ads/metrics";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { LinkedAccount, MutateOp } from "@/lib/google-ads/types";
import { Input } from "@/components/ui/input";
import { Card, Pill, Toggle, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";

const LINKS: Record<LinkedAccount["kind"], { label: string; icon: LucideIcon; why: string }> = {
  MERCHANT_CENTER: { label: "Google Merchant Center", icon: ShoppingBag, why: "Product feed for Shopping and Performance Max" },
  GA4: { label: "Google Analytics 4", icon: BarChart3, why: "Import conversions and audiences, see on-site behaviour" },
  YOUTUBE: { label: "YouTube", icon: MonitorPlay, why: "Use your videos in ads and build audiences from viewers" },
  BUSINESS_PROFILE: { label: "Business Profile", icon: Store, why: "Location assets and store visits" },
  SEARCH_CONSOLE: { label: "Search Console", icon: Search, why: "See paid and organic search side by side" },
};

/** Stable placeholder id for a newly linked product (the real one comes from Google). */
function demoExternalId(seed: string) {
  return String(500000000 + [...seed].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 99999999, 7));
}

export function LinksView() {
  const { data } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);

  const setStatus = (l: LinkedAccount, status: LinkedAccount["status"]) => {
    const ops: MutateOp[] = [{ kind: "collection.upsert", collection: "links", items: [{ ...l, status, externalId: status === "LINKED" ? l.externalId ?? demoExternalId(l.id) : l.externalId }] }];
    if (l.kind === "MERCHANT_CENTER") ops.push({ kind: "account.update", patch: { merchantCenterId: status === "LINKED" ? l.externalId ?? "512889034" : undefined } });
    const res = applyDirect(`${status === "LINKED" ? "Link" : status === "PENDING" ? "Request link to" : "Unlink"} ${LINKS[l.kind].label}`, ops);
    if (res.ok) toast.success(status === "PENDING" ? "Link request sent. Approve it in the other product." : "Saved");
  };

  return (
    <div>
      <ViewHeader title="Linked accounts" subtitle="Connect other Google products so the account and the agent can use their data." />
      <div className="grid gap-3 lg:grid-cols-2">
        {data.links.map((l) => {
          const meta = LINKS[l.kind];
          return (
            <Card key={l.id} className="flex items-start gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                <meta.icon className="h-5 w-5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{meta.label}</p>
                <p className="text-[11px] text-muted-foreground">{meta.why}</p>
                {l.status !== "NOT_LINKED" && <p className="mt-1 text-xs">{l.name}{l.externalId ? ` · ${l.externalId}` : ""}</p>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Pill tone={l.status === "LINKED" ? "good" : l.status === "PENDING" ? "warn" : "neutral"}>{l.status === "LINKED" ? "Linked" : l.status === "PENDING" ? "Pending approval" : "Not linked"}</Pill>
                {l.status === "LINKED" ? (
                  <button type="button" onClick={() => setStatus(l, "NOT_LINKED")} className="text-[11px] font-medium text-red-600 hover:underline">Unlink</button>
                ) : l.status === "PENDING" ? (
                  <button type="button" onClick={() => setStatus(l, "LINKED")} className="text-[11px] font-semibold text-[#400095] hover:underline dark:text-violet-300">Mark approved</button>
                ) : (
                  <button type="button" onClick={() => setStatus(l, l.kind === "YOUTUBE" ? "PENDING" : "LINKED")} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1 text-[11px] font-semibold hover:bg-muted">
                    <Link2 className="h-3 w-3" /> Link
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const CONTENT_CATEGORIES = ["Tragedy & conflict", "Sensitive social issues", "Profanity & rough language", "Sexually suggestive", "Sensational & shocking", "Live streaming video", "Embedded YouTube videos", "Games (in-app)", "Parked domains"];

export function AccountSettingsView() {
  const { data } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [brand, setBrand] = useState("");
  const a = data.account;
  const excluded = a.excludedContent ?? [];
  const brands = a.brandExclusions ?? [];
  const update = (title: string, patch: Extract<MutateOp, { kind: "account.update" }>["patch"]) => applyDirect(title, [{ kind: "account.update", patch }]);

  return (
    <div className="space-y-4">
      <ViewHeader title="Account settings" subtitle={`${a.name} · ${formatCustomerId(a.customerId)}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <p className="text-sm font-bold">Account</p>
          {[
            ["Currency", a.currency, "Set when the account was created; can't change"],
            ["Time zone", a.timeZone, "Reports and schedules use this; can't change"],
            ["Manager", a.managerCustomerId ? formatCustomerId(a.managerCustomerId) : "None", "Manager (MCC) the account is linked to"],
          ].map(([k, v, hint]) => (
            <div key={k} className="flex items-center justify-between gap-3 text-xs">
              <span>
                <span className="block font-semibold">{k}</span>
                <span className="text-[11px] text-muted-foreground">{hint}</span>
              </span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 border-t border-border/60 pt-3">
            <div className="flex-1">
              <p className="text-xs font-semibold">Auto-tagging</p>
              <p className="text-[11px] text-muted-foreground">Adds a click ID (GCLID) to URLs so conversions and Analytics link back to ads.</p>
            </div>
            <Toggle checked={a.autoTagging} label="Auto-tagging" onChange={(v) => update(`Auto-tagging ${v ? "on" : "off"}`, { autoTagging: v })} />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs font-semibold">Enhanced conversions</p>
              <p className="text-[11px] text-muted-foreground">Sends hashed emails/phones from checkout to recover conversions lost to cookie limits.</p>
            </div>
            <Toggle checked={!!a.enhancedConversions} label="Enhanced conversions" onChange={(v) => update(`Enhanced conversions ${v ? "on" : "off"}`, { enhancedConversions: v })} />
          </div>
        </Card>

        <Card className="p-4">
          <p className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-muted-foreground" /> Content suitability</p>
          <p className="mb-3 text-[11px] text-muted-foreground">Keep Display, YouTube and Performance Max ads away from these types of content.</p>
          <div className="flex flex-wrap gap-1.5">
            {CONTENT_CATEGORIES.map((c) => {
              const on = excluded.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => update(`${on ? "Allow" : "Exclude"} content: ${c}`, { excludedContent: on ? excluded.filter((x) => x !== c) : [...excluded, c] })}
                  className={cn("rounded-full border px-2.5 py-1 text-[11px]", on ? "border-red-500/40 bg-red-500/10 font-semibold text-red-700 dark:text-red-400" : "border-border/70 text-muted-foreground")}
                >
                  {on ? "Excluded · " : ""}{c}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <p className="text-sm font-bold">Brand exclusions</p>
          <p className="mb-3 text-[11px] text-muted-foreground">Stop Performance Max and broad match from buying traffic on these brand names (for example competitors you don&apos;t sell, or your own brand when a Brand campaign covers it).</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {brands.map((b) => (
              <span key={b} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold">
                {b}
                <button type="button" onClick={() => update(`Remove brand exclusion ${b}`, { brandExclusions: brands.filter((x) => x !== b) })} aria-label={`Remove ${b}`}><X className="h-3 w-3" /></button>
              </span>
            ))}
            {!brands.length && <span className="text-xs text-muted-foreground">No brands excluded.</span>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const b = brand.trim();
              if (!b || brands.includes(b)) return;
              update(`Exclude brand ${b}`, { brandExclusions: [...brands, b] });
              setBrand("");
            }}
            className="flex max-w-sm gap-2"
          >
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Nike" />
            <button type="submit" className="rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">Add</button>
          </form>
        </Card>
      </div>
    </div>
  );
}

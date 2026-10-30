"use client";

import { useMemo, useState } from "react";
import { Bot, ListX, Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MATCH_TYPES } from "@/lib/google-ads/constants";
import { derive, keywordBase, money } from "@/lib/google-ads/metrics";
import { keywordLabel } from "@/lib/google-ads/mutations";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { EntityStatus, Keyword, MatchType, NegativeKeyword } from "@/lib/google-ads/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { metricColumns } from "../ga-columns";
import { BulkButton, GaTable, type GaColumn } from "../ga-table";
import { Card, EmptyState, Pill, Segmented, StatusMenu, ViewHeader } from "../ga-ui";
import { scopedAdGroupIds, useGa } from "../use-ga";
import { STATUS_FILTERS, SearchBox, filterByStatus, type StatusFilter } from "./campaigns";

const QS_PART: Record<string, string> = { ABOVE_AVERAGE: "Above average", AVERAGE: "Average", BELOW_AVERAGE: "Below average" };

function QualityScore({ k }: { k: Keyword }) {
  if (!k.qualityScore) return <span className="text-muted-foreground">—</span>;
  const tone = k.qualityScore >= 7 ? "bg-emerald-500" : k.qualityScore >= 5 ? "bg-amber-500" : "bg-red-500";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help items-center gap-1.5">
          <span className={cn("flex h-5 w-7 items-center justify-center rounded text-[10px] font-bold text-white", tone)}>{k.qualityScore}/10</span>
        </span>
      </TooltipTrigger>
      {k.qualityParts && (
        <TooltipContent className="space-y-0.5 text-[11px]">
          <p>Expected CTR: {QS_PART[k.qualityParts.expectedCtr]}</p>
          <p>Ad relevance: {QS_PART[k.qualityParts.adRelevance]}</p>
          <p>Landing page: {QS_PART[k.qualityParts.landingPage]}</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function CpcCell({ k, currency, fallback }: { k: Keyword; currency: string; fallback?: number }) {
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(k.cpcBid ?? fallback ?? ""));
  if (editing) {
    const save = () => {
      const n = Number(value);
      if (n > 0 && n !== k.cpcBid) applyDirect(`Max CPC for ${k.text}`, [{ kind: "keyword.update", keywordId: k.id, patch: { cpcBid: n } }]);
      setEditing(false);
    };
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
        className="h-7 w-20 rounded border border-input bg-background px-2 text-right text-xs"
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className="underline decoration-dotted underline-offset-4 hover:text-[#400095]">
      {k.cpcBid ? money(k.cpcBid, currency) : fallback ? money(fallback, currency) : <span className="text-muted-foreground">Auto</span>}
    </button>
  );
}

export function KeywordsView() {
  const { data, range, currency, scope, campaign, adGroup } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [filter, setFilter] = useState<StatusFilter>("ACTIVE");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const ids = new Set(scopedAdGroupIds(data, scope));
  const rows = filterByStatus(data.keywords.filter((k) => ids.has(k.adGroupId)), filter).filter((k) => k.text.includes(query.toLowerCase()));
  const metrics = useMemo(() => new Map(data.keywords.map((k) => [k.id, derive(keywordBase(data, k.id, range))])), [data, range]);
  const totals = derive(
    rows.reduce(
      (s, k) => {
        const m = metrics.get(k.id)!;
        return { impressions: s.impressions + m.impressions, clicks: s.clicks + m.clicks, cost: s.cost + m.cost, conversions: s.conversions + m.conversions, conversionsValue: s.conversionsValue + m.conversionsValue };
      },
      { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 }
    )
  );

  const setStatus = (ids: string[], status: EntityStatus) => {
    applyDirect(`${status === "ENABLED" ? "Enable" : status === "PAUSED" ? "Pause" : "Remove"} ${ids.length} keyword${ids.length > 1 ? "s" : ""}`, [{ kind: "status.set", entity: "KEYWORD", ids, status }]);
    setSelected(new Set());
  };
  const setMatch = (ids: string[], matchType: MatchType) => {
    applyDirect(`Change match type to ${MATCH_TYPES[matchType].label.toLowerCase()}`, ids.map((id) => ({ kind: "keyword.update" as const, keywordId: id, patch: { matchType } })));
    setSelected(new Set());
  };

  const columns: GaColumn<Keyword>[] = [
    { id: "status", header: "", width: "w-8", render: (k) => <StatusMenu status={k.status} onChange={(s) => setStatus([k.id], s)} /> },
    {
      id: "text",
      header: "Keyword",
      sticky: true,
      sortValue: (k) => k.text,
      render: (k) => <span className="font-semibold">{keywordLabel(k.text, k.matchType)}</span>,
      total: <span>Total: {rows.length} keywords</span>,
    },
    ...(!adGroup
      ? [
          {
            id: "adGroup",
            header: "Ad group",
            render: (k: Keyword) => {
              const g = data.adGroups.find((x) => x.id === k.adGroupId);
              return <span className="block max-w-44 truncate text-muted-foreground">{!campaign && `${data.campaigns.find((c) => c.id === g?.campaignId)?.name} › `}{g?.name}</span>;
            },
          },
        ]
      : []),
    { id: "match", header: "Match type", sortValue: (k) => k.matchType, render: (k) => <span className="whitespace-nowrap text-muted-foreground">{MATCH_TYPES[k.matchType].label}</span> },
    {
      id: "policy",
      header: "Status",
      render: (k) => (k.policy === "APPROVED" ? <span className="text-muted-foreground">Eligible</span> : <Pill tone={k.policy === "DISAPPROVED" ? "bad" : k.policy === "UNDER_REVIEW" ? "info" : "warn"}>{k.policy === "APPROVED_LIMITED" ? "Limited" : k.policy === "UNDER_REVIEW" ? "Under review" : "Disapproved"}</Pill>),
    },
    { id: "cpc", header: "Max. CPC", align: "right", render: (k) => <CpcCell k={k} currency={currency} fallback={data.adGroups.find((g) => g.id === k.adGroupId)?.defaultCpcBid} /> },
    { id: "qs", header: "Quality Score", align: "center", sortValue: (k) => k.qualityScore ?? 0, render: (k) => <QualityScore k={k} /> },
    ...metricColumns<Keyword>((k) => metrics.get(k.id)!, currency, { totals }),
  ];

  return (
    <div>
      <ViewHeader
        title="Search keywords"
        subtitle={adGroup ? `In ${adGroup.name}` : campaign ? `In ${campaign.name}` : "Keywords across all Search campaigns"}
        actions={
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Find a keyword" />
            <button type="button" onClick={() => runAgentTurn("Find new keyword ideas")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
              <Bot className="h-3.5 w-3.5" /> Keyword ideas
            </button>
          </>
        }
      >
        <Segmented value={filter} onChange={setFilter} options={STATUS_FILTERS} size="xs" />
      </ViewHeader>
      <GaTable
        rows={rows}
        columns={columns}
        rowKey={(k) => k.id}
        exportName="keywords"
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        defaultSort={{ id: "cost", dir: "desc" }}
        rowClassName={(k) => cn(k.status !== "ENABLED" && "text-muted-foreground")}
        bulkActions={(ids) => (
          <>
            <BulkButton onClick={() => setStatus(ids, "ENABLED")}><Play className="h-3 w-3" /> Enable</BulkButton>
            <BulkButton onClick={() => setStatus(ids, "PAUSED")}><Pause className="h-3 w-3" /> Pause</BulkButton>
            <BulkButton tone="danger" onClick={() => setStatus(ids, "REMOVED")}><Trash2 className="h-3 w-3" /> Remove</BulkButton>
            <span className="h-4 w-px bg-border" />
            {(["EXACT", "PHRASE", "BROAD"] as MatchType[]).map((m) => (
              <BulkButton key={m} onClick={() => setMatch(ids, m)}>{MATCH_TYPES[m].label}</BulkButton>
            ))}
          </>
        )}
        empty="No keywords match this filter."
      />
    </div>
  );
}

export function NegativesView() {
  const { data, scope } = useGa();
  const [level, setLevel] = useState<"ALL" | NegativeKeyword["level"]>("ALL");

  const inScope = (n: NegativeKeyword) => {
    if (!scope.campaignId) return true;
    if (n.level === "CAMPAIGN") return n.parentId === scope.campaignId;
    if (n.level === "AD_GROUP") return scope.adGroupId ? n.parentId === scope.adGroupId : data.adGroups.find((g) => g.id === n.parentId)?.campaignId === scope.campaignId;
    return data.negativeLists.find((l) => l.id === n.parentId)?.campaignIds.includes(scope.campaignId) ?? false;
  };
  const all = data.negatives.filter(inScope);
  const rows = all.filter((n) => level === "ALL" || n.level === level);

  const where = (n: NegativeKeyword) =>
    n.level === "CAMPAIGN"
      ? data.campaigns.find((c) => c.id === n.parentId)?.name
      : n.level === "AD_GROUP"
        ? data.adGroups.find((g) => g.id === n.parentId)?.name
        : data.negativeLists.find((l) => l.id === n.parentId)?.name;

  const columns: GaColumn<NegativeKeyword>[] = [
    { id: "text", header: "Negative keyword", sortValue: (n) => n.text, render: (n) => <span className="font-semibold">{keywordLabel(n.text, n.matchType)}</span> },
    { id: "match", header: "Match type", render: (n) => <span className="text-muted-foreground">{MATCH_TYPES[n.matchType].label}</span> },
    { id: "level", header: "Level", render: (n) => <Pill tone={n.level === "LIST" ? "brand" : "neutral"}>{n.level === "LIST" ? "Shared list" : n.level === "CAMPAIGN" ? "Campaign" : "Ad group"}</Pill> },
    { id: "where", header: "Added to", render: (n) => <span className="block max-w-56 truncate text-muted-foreground">{where(n)}</span> },
  ];

  return (
    <div>
      <ViewHeader
        title="Negative keywords"
        subtitle="Searches that should never show your ads. Exact negatives block one query; broad negatives block any search containing the word."
        actions={
          <>
            <button type="button" onClick={() => runAgentTurn("Where am I wasting budget?")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
              <Bot className="h-3.5 w-3.5" /> Find waste
            </button>
          </>
        }
      >
        <Segmented
          value={level}
          onChange={setLevel}
          size="xs"
          options={[
            { value: "ALL", label: "All", count: all.length },
            { value: "CAMPAIGN", label: "Campaign", count: all.filter((n) => n.level === "CAMPAIGN").length },
            { value: "AD_GROUP", label: "Ad group", count: all.filter((n) => n.level === "AD_GROUP").length },
            { value: "LIST", label: "Shared lists", count: all.filter((n) => n.level === "LIST").length },
          ]}
        />
      </ViewHeader>
      {rows.length ? (
        <GaTable rows={rows} columns={columns} rowKey={(n) => n.id} />
      ) : (
        <EmptyState icon={ListX} title="No negative keywords here" body="Add them yourself or ask the agent to find searches that waste budget." />
      )}
      {!scope.campaignId && data.negativeLists.length > 0 && (
        <Card className="mt-4 p-4">
          <p className="text-sm font-bold">Negative keyword lists</p>
          <p className="mb-3 text-[11px] text-muted-foreground">Shared lists apply the same negatives to many campaigns at once.</p>
          {data.negativeLists.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-2 border-t border-border/50 py-2.5 text-xs first:border-t-0">
              <span className="font-semibold">{l.name}</span>
              <span className="text-muted-foreground">· {data.negatives.filter((n) => n.parentId === l.id).length} keywords · applied to</span>
              {l.campaignIds.map((id) => <Pill key={id}>{data.campaigns.find((c) => c.id === id)?.name}</Pill>)}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Ban, Bot, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { derive, searchTermBase } from "@/lib/google-ads/metrics";
import { gid } from "@/lib/google-ads/mutations";
import { runAgentTurn } from "@/lib/google-ads/agent-runner";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { MutateOp, SearchTerm } from "@/lib/google-ads/types";
import { metricColumns } from "../ga-columns";
import { BulkButton, GaTable, type GaColumn } from "../ga-table";
import { Pill, Segmented, ViewHeader } from "../ga-ui";
import { useGa } from "../use-ga";
import { SearchBox } from "./campaigns";

type Filter = "ALL" | "WASTE" | "CONVERTING";

export function SearchTermsView() {
  const { data, range, currency, scope, campaign, adGroup } = useGa();
  const applyDirect = useGoogleAds((s) => s.applyDirect);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const metrics = useMemo(() => new Map(data.searchTerms.map((t) => [t.id, derive(searchTermBase(data, t.id, range))])), [data, range]);
  const scoped = data.searchTerms.filter(
    (t) => (!scope.campaignId || t.campaignId === scope.campaignId) && (!scope.adGroupId || t.adGroupId === scope.adGroupId)
  );
  const rows = scoped
    .filter((t) => t.text.includes(query.toLowerCase()))
    .filter((t) => {
      const m = metrics.get(t.id)!;
      if (filter === "WASTE") return m.cost > 0 && m.conversions < 0.5;
      if (filter === "CONVERTING") return m.conversions >= 0.5;
      return true;
    });
  const wasteCount = scoped.filter((t) => metrics.get(t.id)!.cost > 0 && metrics.get(t.id)!.conversions < 0.5).length;

  const addAsKeyword = (ids: string[]) => {
    const terms = data.searchTerms.filter((t) => ids.includes(t.id) && t.adGroupId && t.status === "NONE");
    if (!terms.length) return;
    const ops: MutateOp[] = [
      { kind: "keyword.create", keywords: terms.map((t) => ({ id: gid("k"), adGroupId: t.adGroupId, text: t.text, matchType: "EXACT" as const, status: "ENABLED" as const, policy: "UNDER_REVIEW" as const })) },
      { kind: "searchTerm.mark", ids: terms.map((t) => t.id), status: "ADDED" },
    ];
    applyDirect(`Add ${terms.length} search term${terms.length > 1 ? "s" : ""} as keywords`, ops);
    setSelected(new Set());
  };
  const addAsNegative = (ids: string[]) => {
    const terms = data.searchTerms.filter((t) => ids.includes(t.id) && t.status === "NONE");
    if (!terms.length) return;
    applyDirect(`Exclude ${terms.length} search term${terms.length > 1 ? "s" : ""}`, [
      { kind: "negative.create", negatives: terms.map((t) => ({ id: gid("n"), text: t.text, matchType: "EXACT" as const, level: "CAMPAIGN" as const, parentId: t.campaignId })) },
      { kind: "searchTerm.mark", ids: terms.map((t) => t.id), status: "EXCLUDED" },
    ]);
    setSelected(new Set());
  };

  const columns: GaColumn<SearchTerm>[] = [
    {
      id: "text",
      header: "Search term",
      sticky: true,
      sortValue: (t) => t.text,
      render: (t) => (
        <span className="flex items-center gap-2">
          <span className="font-semibold">{t.text}</span>
          {t.status === "ADDED" && <Pill tone="good">Added</Pill>}
          {t.status === "EXCLUDED" && <Pill tone="bad">Excluded</Pill>}
        </span>
      ),
    },
    {
      id: "via",
      header: "Match type",
      render: (t) => <span className="whitespace-nowrap text-muted-foreground">{t.matchedVia === "PMAX" ? "Performance Max" : t.matchedVia === "AI_MAX" ? "AI Max" : t.matchedVia.charAt(0) + t.matchedVia.slice(1).toLowerCase()}</span>,
    },
    ...(!adGroup
      ? [
          {
            id: "where",
            header: campaign ? "Ad group" : "Campaign / ad group",
            render: (t: SearchTerm) => (
              <span className="block max-w-52 truncate text-muted-foreground">
                {!campaign && data.campaigns.find((c) => c.id === t.campaignId)?.name}
                {!campaign && t.adGroupId && " › "}
                {data.adGroups.find((g) => g.id === t.adGroupId)?.name}
              </span>
            ),
          },
        ]
      : []),
    {
      id: "keyword",
      header: "Keyword",
      render: (t) => <span className="text-muted-foreground">{data.keywords.find((k) => k.id === t.keywordId)?.text ?? "—"}</span>,
    },
    ...metricColumns<SearchTerm>((t) => metrics.get(t.id)!, currency, { keys: ["impressions", "clicks", "ctr", "cost", "conversions", "cpa", "roas"] }),
  ];

  return (
    <div>
      <ViewHeader
        title="Search terms"
        subtitle="What people actually typed before they saw your ad. Add good ones as keywords, exclude the rest."
        actions={
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Find a search term" />
            <button type="button" onClick={() => runAgentTurn("Where am I wasting budget?")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-3 text-xs font-semibold hover:bg-muted">
              <Bot className="h-3.5 w-3.5" /> Analyse with agent
            </button>
          </>
        }
      >
        <Segmented
          value={filter}
          onChange={setFilter}
          size="xs"
          options={[
            { value: "ALL", label: "All" },
            { value: "WASTE", label: "Spending, no conversions", count: wasteCount },
            { value: "CONVERTING", label: "Converting" },
          ]}
        />
      </ViewHeader>
      <GaTable
        rows={rows}
        columns={columns}
        rowKey={(t) => t.id}
        exportName="search-terms"
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        defaultSort={{ id: "cost", dir: "desc" }}
        rowClassName={(t) => cn(metrics.get(t.id)!.cost > 8 && metrics.get(t.id)!.conversions < 0.5 && t.status === "NONE" && "bg-red-500/[0.03]")}
        bulkActions={(ids) => (
          <>
            <BulkButton onClick={() => addAsKeyword(ids)}><Plus className="h-3 w-3" /> Add as keyword</BulkButton>
            <BulkButton tone="danger" onClick={() => addAsNegative(ids)}><Ban className="h-3 w-3" /> Add as negative</BulkButton>
          </>
        )}
        empty="No search terms for this selection."
      />
    </div>
  );
}

"use client";

import { LayoutDashboard, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOC_TYPES } from "@/lib/google-ads/docs";
import { useAccountState, useGoogleAds } from "@/lib/google-ads/store";

/**
 * Browser-style tabs: the account, then every document the agent opened.
 * Documents are only created by the agent (no manual "+"); the user can open and close them.
 */
export function DocTabs() {
  const acc = useAccountState();
  const setActiveTab = useGoogleAds((s) => s.setActiveTab);
  const closeDocTab = useGoogleAds((s) => s.closeDocTab);
  if (!acc) return null;
  const tabs = acc.openDocIds.map((id) => acc.docs.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);

  return (
    <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-border/60 bg-muted/40 px-2 pt-1.5">
      <button
        type="button"
        onClick={() => setActiveTab("account")}
        className={cn(
          "flex h-full shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 text-xs font-semibold transition-colors",
          acc.activeTab === "account" ? "border-border/60 bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-background/60"
        )}
      >
        <LayoutDashboard className="h-3.5 w-3.5" /> Account
      </button>
      {tabs.map((d) => {
        const active = acc.activeTab === d.id;
        return (
          <div
            key={d.id}
            className={cn(
              "group flex h-full max-w-56 shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 pl-3 pr-1 text-xs transition-colors",
              active ? "border-border/60 bg-background font-semibold text-foreground" : "border-transparent text-muted-foreground hover:bg-background/60"
            )}
          >
            <button type="button" onClick={() => setActiveTab(d.id)} className="flex min-w-0 items-center gap-1.5">
              <span>{DOC_TYPES[d.type].emoji}</span>
              <span className="truncate">{d.title}</span>
              {d.changedSectionIds.length > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#F76D01]" title="Updated" />}
            </button>
            <button type="button" onClick={() => closeDocTab(d.id)} className="rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100" aria-label={`Close ${d.title}`}>
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

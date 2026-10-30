"use client";

import { useState } from "react";
import {
  Brain,
  FileStack,
  BarChart3,
  BellRing,
  Calculator,
  FlaskConical,
  Globe,
  Link2,
  ShoppingBag,
  Split,
  Telescope,
  Users2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  FolderKanban,
  History,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  Library,
  Lightbulb,
  ListX,
  MapPin,
  Plug,
  Search,
  Settings2,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CAMPAIGN_TYPES } from "@/lib/google-ads/constants";
import { useAccountState, useGoogleAds } from "@/lib/google-ads/store";
import type { GaView } from "@/lib/google-ads/types";
import { StatusDot } from "./ga-ui";

type NavItem = { view: GaView; label: string; icon: LucideIcon; badge?: string | number; hidden?: boolean };

export function GaNav() {
  const acc = useAccountState();
  const view = useGoogleAds((s) => s.view);
  const scope = useGoogleAds((s) => s.scope);
  const setView = useGoogleAds((s) => s.setView);
  const setScope = useGoogleAds((s) => s.setScope);
  const [treeOpen, setTreeOpen] = useState(true);
  if (!acc) return null;
  const { data } = acc;

  const scopedCampaign = data.campaigns.find((c) => c.id === scope.campaignId);
  const isPmax = scopedCampaign?.type === "PERFORMANCE_MAX";
  const pending = acc.changes.filter((c) => c.status === "PENDING").length;
  const recs = data.recommendations.filter((r) => r.status === "ACTIVE").length;

  const isShopping = scopedCampaign?.type === "SHOPPING";
  const isVisual = !!scopedCampaign && ["DISPLAY", "VIDEO", "DEMAND_GEN"].includes(scopedCampaign.type);
  const unread = data.alerts.filter((a) => !a.read).length;
  const inCampaign = !!scope.campaignId;

  const groups: { title?: string; items: NavItem[] }[] = [
    {
      items: [
        { view: "overview", label: "Overview", icon: LayoutDashboard },
        { view: "recommendations", label: "Recommendations", icon: Lightbulb, badge: recs || undefined, hidden: !!scope.adGroupId },
        { view: "reports", label: "Reports", icon: BarChart3 },
      ],
    },
    {
      title: "Campaigns",
      items: [
        { view: "campaigns", label: "Campaigns", icon: FolderKanban, hidden: inCampaign },
        { view: "adGroups", label: isPmax ? "Asset groups" : "Ad groups", icon: FolderKanban, hidden: !!scope.adGroupId },
        { view: "productGroups", label: "Product groups", icon: Split, hidden: !isShopping || !!scope.adGroupId },
        { view: "ads", label: "Ads", icon: FileText, hidden: isPmax || isShopping },
        { view: "assets", label: "Assets", icon: ImageIcon },
        { view: "products", label: "Products", icon: ShoppingBag, hidden: inCampaign },
      ],
    },
    {
      title: "Keywords & audiences",
      items: [
        { view: "keywords", label: "Search keywords", icon: KeyRound, hidden: isPmax || isShopping || isVisual },
        { view: "negatives", label: "Negative keywords", icon: ListX },
        { view: "searchTerms", label: "Search terms", icon: Search, hidden: isVisual },
        { view: "audiences", label: "Audiences", icon: Users },
        { view: "demographics", label: "Demographics", icon: Users2, hidden: isPmax || isShopping || !!scope.adGroupId },
        { view: "content", label: "Placements & content", icon: Globe, hidden: (!!scopedCampaign && !isVisual) || !!scope.adGroupId },
        { view: "locations", label: "Locations & schedule", icon: MapPin, hidden: !!scope.adGroupId },
      ],
    },
    {
      title: "Plan & test",
      items: [
        { view: "keywordPlanner", label: "Keyword Planner", icon: Telescope, hidden: inCampaign },
        { view: "planner", label: "Performance Planner", icon: Calculator, hidden: !!scope.adGroupId },
        { view: "experiments", label: "Experiments", icon: FlaskConical, hidden: inCampaign },
      ],
    },
    {
      title: "Goals & tools",
      items: [
        { view: "conversions", label: "Conversions", icon: Target, hidden: inCampaign },
        { view: "library", label: "Shared library", icon: Library, hidden: inCampaign },
        { view: "links", label: "Linked accounts", icon: Link2, hidden: inCampaign },
        { view: "connections", label: "Connections", icon: Plug, hidden: inCampaign },
        { view: "accountSettings", label: "Account settings", icon: Settings2, hidden: inCampaign },
        { view: "settings", label: "Campaign settings", icon: Settings2, hidden: !scope.campaignId || !!scope.adGroupId },
      ],
    },
    {
      title: "Agent",
      items: [
        { view: "documents", label: "Documents", icon: FileStack, badge: acc.docs.length || undefined, hidden: inCampaign },
        { view: "profile", label: "Business profile", icon: Brain, hidden: inCampaign },
        { view: "rules", label: "Rules & alerts", icon: BellRing, badge: unread || undefined, hidden: inCampaign },
        { view: "pending", label: "Pending changes", icon: ClipboardCheck, badge: pending || undefined },
        { view: "history", label: "Change history", icon: History },
      ],
    },
  ];

  const campaigns = data.campaigns.filter((c) => c.status !== "REMOVED");

  return (
    <nav className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-muted/20 px-2 py-3">
      {groups.map((g, gi) => {
        const items = g.items.filter((i) => !i.hidden);
        if (!items.length) return null;
        return (
          <div key={gi} className={cn(gi > 0 && "mt-3")}>
            {g.title && <p className="mb-1 px-2.5 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/70">{g.title}</p>}
            {items.map((item) => {
              const active = view === item.view;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => setView(item.view)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                    active ? "bg-[#400095]/10 text-[#400095] dark:bg-violet-500/15 dark:text-violet-300" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 text-[10px] font-bold",
                        item.view === "pending" || item.view === "rules" ? "bg-[#F76D01] text-white" : "bg-muted-foreground/15 text-muted-foreground"
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}

      <div className="mt-4 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => setTreeOpen((o) => !o)}
          className="flex w-full items-center gap-1 px-2.5 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/70"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", !treeOpen && "-rotate-90")} />
          All campaigns
          <span className="ml-auto font-semibold tracking-normal">{campaigns.length}</span>
        </button>
        {treeOpen && (
          <div className="mt-1.5 space-y-px">
            <button
              type="button"
              onClick={() => setScope({}, view === "settings" ? "campaigns" : undefined)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px]",
                !scope.campaignId ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              Account overview
            </button>
            {campaigns.map((c) => {
              const active = scope.campaignId === c.id;
              const groups = c.type === "PERFORMANCE_MAX" ? data.assetGroups.filter((g) => g.campaignId === c.id && g.status !== "REMOVED") : data.adGroups.filter((g) => g.campaignId === c.id && g.status !== "REMOVED");
              return (
                <div key={c.id}>
                  <button
                    type="button"
                    onClick={() => setScope({ campaignId: c.id })}
                    title={`${c.name} · ${CAMPAIGN_TYPES[c.type].label}`}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px]",
                      active && !scope.adGroupId ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <StatusDot status={c.status} className="h-2 w-2 ring-0" />
                    <span className="truncate">{c.name}</span>
                  </button>
                  {active && c.type !== "PERFORMANCE_MAX" && (
                    <div className="ml-4 border-l border-border/60 pl-1.5">
                      {groups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setScope({ campaignId: c.id, adGroupId: g.id }, view === "adGroups" ? "keywords" : undefined)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px]",
                            scope.adGroupId === g.id ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"
                          )}
                        >
                          <StatusDot status={g.status} className="h-1.5 w-1.5 ring-0" />
                          <span className="truncate">{g.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}

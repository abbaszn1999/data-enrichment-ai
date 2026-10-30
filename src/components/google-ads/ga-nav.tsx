"use client";

import {
  Brain,
  FileStack,
  BarChart3,
  BellRing,
  FlaskConical,
  Globe,
  Link2,
  Split,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  Library,
  Lightbulb,
  MapPin,
  Plug,
  Settings2,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAccountState, useGoogleAds } from "@/lib/google-ads/store";
import type { GaView } from "@/lib/google-ads/types";
import { TAB_GROUPS, navCtx, visibleTabs } from "./nav-model";

type NavItem = { view: GaView; label: string; icon: LucideIcon; badge?: string | number; hidden?: boolean; /** Pages that count as this item being open (tabbed items). */ views?: GaView[] };

export function GaNav() {
  const acc = useAccountState();
  const view = useGoogleAds((s) => s.view);
  const scope = useGoogleAds((s) => s.scope);
  const setView = useGoogleAds((s) => s.setView);
  if (!acc) return null;
  const { data } = acc;

  const scopedCampaign = data.campaigns.find((c) => c.id === scope.campaignId);
  const isPmax = scopedCampaign?.type === "PERFORMANCE_MAX";
  const recs = data.recommendations.filter((r) => r.status === "ACTIVE").length;

  const isShopping = scopedCampaign?.type === "SHOPPING";
  const isVisual = !!scopedCampaign && ["DISPLAY", "VIDEO", "DEMAND_GEN"].includes(scopedCampaign.type);
  const unread = data.alerts.filter((a) => !a.read).length;
  const inCampaign = !!scope.campaignId;

  const ctx = navCtx(data.campaigns, scope);
  const tabItem = (id: string, icon: LucideIcon, hidden = false): NavItem => {
    const g = TAB_GROUPS.find((x) => x.id === id)!;
    const tabs = visibleTabs(g, ctx);
    return { view: tabs[0]?.view ?? g.tabs[0]!.view, views: g.tabs.map((t) => t.view), label: g.label, icon, hidden: hidden || !tabs.length };
  };

  // The dashboard is view-only: the agent does the work, so there are no
  // planner forms, approval pages or change logs here (approvals are in the chat).
  const groups: { title?: string; items: NavItem[] }[] = [
    {
      items: [
        { view: "overview", label: "Overview", icon: LayoutDashboard },
        { view: "recommendations", label: "Recommendations", icon: Lightbulb, badge: recs || undefined, hidden: !!scope.adGroupId },
        { view: "reports", label: "Reports", icon: BarChart3 },
      ],
    },
    {
      title: "Structure",
      items: [
        { view: "campaigns", label: "Campaigns", icon: FolderKanban, hidden: inCampaign },
        { view: "adGroups", label: isPmax ? "Asset groups" : "Ad groups", icon: FolderKanban, hidden: !!scope.adGroupId },
        { view: "productGroups", label: "Product groups", icon: Split, hidden: !isShopping || !!scope.adGroupId },
        { view: "ads", label: "Ads", icon: FileText, hidden: isPmax || isShopping },
        { view: "experiments", label: "Experiments", icon: FlaskConical, hidden: inCampaign },
        { view: "assets", label: "Assets", icon: ImageIcon },
      ],
    },
    {
      title: "Targeting & queries",
      items: [
        tabItem("keywords", KeyRound),
        tabItem("audiences", Users),
        { view: "content", label: "Placements & content", icon: Globe, hidden: (!!scopedCampaign && !isVisual) || !!scope.adGroupId },
        tabItem("locations", MapPin, !!scope.adGroupId),
      ],
    },
    {
      title: "Setup",
      items: [
        { view: "library", label: "Shared library", icon: Library, hidden: inCampaign },
        { view: "conversions", label: "Conversions", icon: Target, hidden: inCampaign },
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
      ],
    },
  ];

  return (
    <nav className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-muted/20 px-2 py-3">
      {groups.map((g, gi) => {
        const items = g.items.filter((i) => !i.hidden);
        if (!items.length) return null;
        return (
          <div key={gi} className={cn(gi > 0 && "mt-3")}>
            {g.title && <p className="mb-1 px-2.5 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/70">{g.title}</p>}
            {items.map((item) => {
              const active = item.views ? item.views.includes(view) : view === item.view;
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

    </nav>
  );
}

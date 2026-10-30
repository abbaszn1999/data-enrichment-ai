import type { Campaign, CampaignType, GaScope, GaView } from "@/lib/google-ads/types";

/** Where the user is: drives which sidebar items and which tabs make sense. */
export type NavCtx = { campaignType?: CampaignType; inCampaign: boolean; inAdGroup: boolean };

export function navCtx(campaigns: Pick<Campaign, "id" | "type">[], scope: GaScope): NavCtx {
  const campaign = campaigns.find((c) => c.id === scope.campaignId);
  return { campaignType: campaign?.type, inCampaign: !!scope.campaignId, inAdGroup: !!scope.adGroupId };
}

const isVisual = (c: NavCtx) => !!c.campaignType && ["DISPLAY", "VIDEO", "DEMAND_GEN"].includes(c.campaignType);
const isPmaxOrShopping = (c: NavCtx) => c.campaignType === "PERFORMANCE_MAX" || c.campaignType === "SHOPPING";

export type TabDef = { view: GaView; label: string; show?: (c: NavCtx) => boolean };

/**
 * Sidebar items that are one page with tabs, like Google Ads' own
 * Keywords section. Each tab is still its own view, so the agent can link
 * straight to one (for example, Search terms).
 */
export type TabGroup = { id: string; label: string; tabs: TabDef[] };

export const TAB_GROUPS: TabGroup[] = [
  {
    id: "keywords",
    label: "Keywords",
    tabs: [
      { view: "keywords", label: "Search keywords", show: (c) => !isPmaxOrShopping(c) && !isVisual(c) },
      { view: "negatives", label: "Negative keywords" },
      { view: "searchTerms", label: "Search terms", show: (c) => !isVisual(c) },
    ],
  },
  {
    id: "audiences",
    label: "Audiences",
    tabs: [
      { view: "audiences", label: "Audiences" },
      { view: "demographics", label: "Demographics", show: (c) => !isPmaxOrShopping(c) && !c.inAdGroup },
    ],
  },
  {
    id: "locations",
    label: "Locations & schedule",
    tabs: [
      { view: "locations", label: "Locations" },
      { view: "schedule", label: "Ad schedule" },
      { view: "devices", label: "Devices" },
    ],
  },
];

export const tabGroupOf = (view: GaView) => TAB_GROUPS.find((g) => g.tabs.some((t) => t.view === view));

export const visibleTabs = (group: TabGroup, ctx: NavCtx) => group.tabs.filter((t) => !t.show || t.show(ctx));

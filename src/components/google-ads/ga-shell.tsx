"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGoogleAds } from "@/lib/google-ads/store";
import type { GaView } from "@/lib/google-ads/types";
import { GaCampaignEditor } from "./ga-campaign-editor";
import { GaChat } from "./ga-chat";
import { GaConnect } from "./ga-connect";
import { GaDialogs } from "./ga-dialogs";
import { GaNav } from "./ga-nav";
import { GaTopbar } from "./ga-topbar";
import { AdGroupsView } from "./views/ad-groups";
import { AdsView } from "./views/ads";
import { AssetsView } from "./views/assets";
import { AudiencesView } from "./views/audiences";
import { CampaignsView } from "./views/campaigns";
import { HistoryView, PendingView } from "./views/changes";
import { ConversionsView } from "./views/conversions";
import { KeywordsView, NegativesView } from "./views/keywords";
import { LibraryView } from "./views/library";
import { LocationsView } from "./views/locations";
import { OverviewView } from "./views/overview";
import { RecommendationsView } from "./views/recommendations";
import { SearchTermsView } from "./views/search-terms";
import { SettingsView } from "./views/settings";
import { AccountSettingsView, LinksView } from "./views/account";
import { ProductGroupsView, ProductsView } from "./views/products";
import { ConnectionsView } from "./views/connections";
import { MerchantConnectDialog } from "./ga-merchant";
import { ReportsView } from "./views/reports";
import { RulesView } from "./views/rules";
import { ContentView, DemographicsView } from "./views/targeting";
import { ExperimentsView, KeywordPlannerView, PlannerView } from "./views/tools";
import { DocumentsView, ProfileView } from "./views/documents";
import { DocTabs } from "./docs/doc-tabs";
import { DocView } from "./docs/doc-view";
import { useAccountState } from "@/lib/google-ads/store";

const VIEWS: Record<GaView, () => React.ReactNode> = {
  overview: OverviewView,
  campaigns: CampaignsView,
  adGroups: AdGroupsView,
  ads: AdsView,
  assets: AssetsView,
  keywords: KeywordsView,
  negatives: NegativesView,
  searchTerms: SearchTermsView,
  audiences: AudiencesView,
  locations: LocationsView,
  recommendations: RecommendationsView,
  conversions: ConversionsView,
  library: LibraryView,
  settings: SettingsView,
  pending: PendingView,
  history: HistoryView,
  products: ProductsView,
  productGroups: ProductGroupsView,
  reports: ReportsView,
  rules: RulesView,
  keywordPlanner: KeywordPlannerView,
  experiments: ExperimentsView,
  planner: PlannerView,
  content: ContentView,
  demographics: DemographicsView,
  links: LinksView,
  accountSettings: AccountSettingsView,
  documents: DocumentsView,
  profile: ProfileView,
  connections: ConnectionsView,
};

// Like the Store Agent: the agent panel is always there and is resized by dragging the divider.
const CHAT_DEFAULT = 440;
const CHAT_MIN = 360;
const chatMax = () => Math.max(CHAT_MIN, Math.round(window.innerWidth * 0.6));

/**
 * Google Ads agent workspace: agent chat on the left, a full Google Ads-style
 * account manager on the right. Front-end prototype on demo data.
 */
export function GoogleAdsShell() {
  const status = useGoogleAds((s) => s.status);
  const entered = useGoogleAds((s) => s.entered);
  // Connecting Google Ads alone stays on the connect screen until "Go to agent".
  const inWorkspace = status === "connected" && entered;
  return (
    <>
      {inWorkspace ? (
        <TooltipProvider delayDuration={200}>
          <Workspace />
        </TooltipProvider>
      ) : (
        <GaConnect />
      )}
      <MerchantConnectDialog />
    </>
  );
}

function Workspace() {
  const view = useGoogleAds((s) => s.view);
  const customerId = useGoogleAds((s) => s.customerId);
  const scope = useGoogleAds((s) => s.scope);
  const activeTab = useAccountState()?.activeTab ?? "account";
  const [width, setWidth] = useState(CHAT_DEFAULT);
  const drag = useRef<{ x: number; w: number } | null>(null);

  const onDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      drag.current = { x: e.clientX, w: width };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
    },
    [width]
  );
  const onMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(Math.min(chatMax(), Math.max(CHAT_MIN, drag.current.w + e.clientX - drag.current.x)));
  }, []);
  const onUp = useCallback(() => {
    drag.current = null;
    document.body.style.userSelect = "";
  }, []);

  const View = VIEWS[view];

  return (
    <div className="autommerce-dashboard flex h-full min-h-0 w-full bg-background [font-family:var(--brand-font)]">
      {/* Agent panel: the lighter surface. The ads panel on the right is the recessed canvas (tinted in light, darkest in dark), so the two read as different places. */}
      <GaChat width={width} />
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · double-click to reset"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={() => setWidth(CHAT_DEFAULT)}
        className="w-1 shrink-0 cursor-col-resize border-s bg-border/40 transition-colors hover:bg-[#6B358D]/40 dark:hover:bg-[#F76D01]/40"
      />
      <div className="flex min-w-0 flex-1 flex-col bg-[#F6F4FA] dark:bg-background">
        <DocTabs />
        {activeTab === "account" ? (
          <>
            <GaTopbar />
            <div className="flex min-h-0 flex-1">
              <GaNav />
              <main className="min-w-0 flex-1 overflow-y-auto">
                {/* Keyed so local view state (filters, selection) resets with the account or scope. */}
                <div key={`${customerId}:${scope.campaignId ?? ""}:${scope.adGroupId ?? ""}:${view}`} className="mx-auto max-w-[1400px] px-5 py-5">
                  <View />
                </div>
              </main>
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1">
            <DocView docId={activeTab} />
          </div>
        )}
      </div>
      <GaDialogs />
      <GaCampaignEditor />
    </div>
  );
}

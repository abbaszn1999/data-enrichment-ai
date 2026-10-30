import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useGoogleAds } from "@/lib/google-ads/store";
import { planAgentTurn } from "@/lib/google-ads/agent-sim";
import type { CampaignType, GaView } from "@/lib/google-ads/types";
import { GoogleAdsShell } from "./ga-shell";
import { GaDialogs } from "./ga-dialogs";
import { GaCampaignEditor } from "./ga-campaign-editor";
import { emptyBundle } from "@/lib/google-ads/mutations";

// Server rendering reads zustand's initial state; make it read the live state instead.
const originalUseSyncExternalStore = React.useSyncExternalStore;
(React as { useSyncExternalStore: typeof React.useSyncExternalStore }).useSyncExternalStore = (subscribe, getSnapshot) =>
  originalUseSyncExternalStore(subscribe, getSnapshot, getSnapshot);

const VIEWS: GaView[] = ["overview", "campaigns", "adGroups", "ads", "assets", "keywords", "negatives", "searchTerms", "audiences", "locations", "recommendations", "conversions", "library", "settings", "pending", "history", "products", "productGroups", "reports", "rules", "keywordPlanner", "experiments", "planner", "content", "demographics", "links", "accountSettings", "documents", "profile", "connections"];

function connect(customer = "7316204458") {
  const s = useGoogleAds.getState();
  s.disconnect();
  s.disconnectMerchant();
  s.completeAuth();
  useGoogleAds.getState().selectAccount(customer);
}

describe("render smoke", () => {
  it("renders connect screens", () => {
    useGoogleAds.getState().disconnect();
    expect(renderToString(createElement(GoogleAdsShell))).toContain("Connect Google Ads");
    useGoogleAds.getState().startConnect();
    expect(renderToString(createElement(GoogleAdsShell))).toContain("Choose an account");
    useGoogleAds.getState().completeAuth();
    expect(renderToString(createElement(GoogleAdsShell))).toContain("Choose an ad account");
  });

  it("shows two connections and 'Go to agent' only once Google Ads is connected", () => {
    const s = useGoogleAds.getState();
    s.disconnect();
    s.disconnectMerchant();
    let html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Connect Google Ads");
    expect(html).toContain("Connect Merchant Center");
    expect(html).not.toContain("Go to agent");

    // Merchant Center alone does not open the agent.
    s.completeMerchantAuth();
    s.selectMerchantAccount("512889034");
    html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Merchant Center connected");
    expect(html).toContain("Connect Google Ads");
    expect(html).not.toContain("Go to agent");

    s.completeAuth();
    useGoogleAds.getState().chooseAccount("7316204458");
    html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Google Ads connected");
    expect(html).toContain("Go to agent");
    expect(html).not.toContain("Ads agent");

    useGoogleAds.getState().enterWorkspace();
    expect(renderToString(createElement(GoogleAdsShell))).toContain("Ads agent");
  });

  it("lets Google Ads connect without Merchant Center", () => {
    const s = useGoogleAds.getState();
    s.disconnect();
    s.disconnectMerchant();
    s.completeAuth();
    useGoogleAds.getState().chooseAccount("7316204458");
    const html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Go to agent");
    expect(html).toContain("Connect Merchant Center");
    useGoogleAds.getState().enterWorkspace();
    expect(useGoogleAds.getState().entered).toBe(true);
    expect(useGoogleAds.getState().merchant.merchantId).toBeNull();
  });

  it("connects, switches, reconnects and disconnects Merchant Center from Connections", () => {
    connect();
    useGoogleAds.setState({ view: "connections", scope: {} });
    let html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Connect Merchant Center");
    expect(html).toContain("Locked until Merchant Center is connected");

    const s = useGoogleAds.getState();
    s.startMerchantConnect();
    expect(renderToString(createElement(GoogleAdsShell))).toContain("Choose an account");
    useGoogleAds.getState().completeMerchantAuth();
    html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Choose a Merchant Center account");
    expect(html).toContain("Linked to ");
    useGoogleAds.getState().selectMerchantAccount("512889034");
    html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Stride Store Feed");
    expect(html).not.toContain("Locked until Merchant Center is connected");

    // Another Merchant Center account than the one linked to this ad account.
    useGoogleAds.getState().changeMerchantAccount();
    useGoogleAds.getState().selectMerchantAccount("512889077");
    html = renderToString(createElement(GoogleAdsShell));
    expect(html).toMatch(/Linked to (<!-- -->)?512889034/);

    // Cancelling a reconnect keeps the connected account.
    useGoogleAds.getState().startMerchantConnect();
    useGoogleAds.getState().cancelMerchantConnect();
    expect(useGoogleAds.getState().merchant.status).toBe("connected");
    expect(useGoogleAds.getState().merchant.merchantId).toBe("512889077");

    useGoogleAds.getState().disconnectMerchant();
    expect(useGoogleAds.getState().merchant.merchantId).toBeNull();
    expect(renderToString(createElement(GoogleAdsShell))).toContain("Locked until Merchant Center is connected");
  });

  it("ignores an unknown Merchant Center account", () => {
    const s = useGoogleAds.getState();
    s.disconnectMerchant();
    s.completeMerchantAuth();
    useGoogleAds.getState().selectMerchantAccount("nope");
    expect(useGoogleAds.getState().merchant.status).toBe("selecting");
    useGoogleAds.getState().cancelMerchantConnect();
    expect(useGoogleAds.getState().merchant.status).toBe("disconnected");
  });

  it("the agent says Merchant Center is missing instead of proposing feed fixes", () => {
    connect();
    const s = useGoogleAds.getState();
    const data = s.accounts[s.customerId!].data;
    const without = planAgentTurn("Fix my Merchant Center product issues", { data, range: s.range, scope: {}, merchantConnected: false });
    expect(without.changes).toHaveLength(0);
    expect(without.viewHint).toBe("connections");
    expect(without.reply).toContain("Merchant Center isn't connected");
    const withMc = planAgentTurn("Fix my Merchant Center product issues", { data, range: s.range, scope: {}, merchantConnected: true });
    expect(withMc.changes.length).toBeGreaterThan(0);
  });

  for (const scope of [{}, { campaignId: "c_running" }, { campaignId: "c_running", adGroupId: "ag_run_men" }, { campaignId: "c_pmax" }, { campaignId: "c_shopping" }, { campaignId: "c_demandgen" }]) {
    for (const view of VIEWS) {
      it(`renders ${view} at ${JSON.stringify(scope)}`, () => {
        connect();
        useGoogleAds.setState({ scope, view });
        const html = renderToString(createElement(GoogleAdsShell));
        expect(html).toContain("Ads agent");
        expect(html).not.toContain("Connect Google Ads");
      });
    }
  }

  it("renders every view on the empty account", () => {
    connect("9082215570");
    for (const view of VIEWS) {
      useGoogleAds.setState({ view, scope: {} });
      expect(() => renderToString(createElement(GoogleAdsShell))).not.toThrow();
    }
  });

  it("renders chat with agent replies and pending changes", () => {
    connect();
    const s = useGoogleAds.getState();
    const state = s.accounts[s.customerId!];
    for (const prompt of ["Run a full audit of my account", "Create a Search campaign for running shoes in Saudi Arabia with $60/day"]) {
      const plan = planAgentTurn(prompt, { data: state.data, range: s.range, scope: {} });
      s.addMessage({ id: `u-${prompt}`, role: "user", text: prompt, at: "" });
      const ids = plan.changes.map((c) => useGoogleAds.getState().propose(c).id);
      s.addMessage({ id: `a-${prompt}`, role: "agent", text: plan.reply, at: "", steps: plan.steps, changeIds: ids, followUps: plan.followUps, draftBundle: plan.draftBundle });
    }
    useGoogleAds.setState({ view: "pending" });
    const html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Approve");
    const first = useGoogleAds.getState().accounts[s.customerId!].changes.at(-1)!;
    useGoogleAds.getState().applyChange(first.id);
    useGoogleAds.setState({ view: "history" });
    expect(renderToString(createElement(GoogleAdsShell))).toContain("Undo");
  });

  it("renders every document type in a tab", async () => {
    connect();
    const { buildPlanDoc, buildReportDoc, buildAuditDoc, buildBudgetDoc, buildKeywordDoc, buildAdCopyDoc, buildFeedDoc, buildCompetitorDoc, buildExperimentDoc } = await import("@/lib/google-ads/agent-docs");
    const s = useGoogleAds.getState();
    const state = s.accounts[s.customerId!];
    const c = { data: state.data, range: s.range, scope: {}, profile: state.profile, memories: state.memories };
    const docs = [buildPlanDoc(c, { occasion: "Ramadan", budget: 5000, goal: "Sales", focus: "Running shoes" }), buildReportDoc(c), buildAuditDoc(c), buildBudgetDoc(c, 12000), buildKeywordDoc(c, "trail shoes"), buildAdCopyDoc(c, "leggings"), buildFeedDoc(c), buildCompetitorDoc(c), buildExperimentDoc(c)];
    for (const d of docs) {
      useGoogleAds.getState().createDoc(d);
      const html = renderToString(createElement(GoogleAdsShell));
      expect(html).toContain(d.title.replace(/&/g, "&amp;").slice(0, 12));
    }
  });

  it("renders chat with team, todo, questions and a doc card", () => {
    connect();
    const s = useGoogleAds.getState();
    s.addMessage({ id: "u1", role: "user", text: "Make me a Ramadan campaign plan", at: "" });
    s.addMessage({ id: "a1", role: "agent", text: "Three quick questions", at: "", questions: [{ id: "budget", label: "Total budget", options: ["$3,000"] }], team: [{ role: "Analyst", task: "Reading", status: "WORKING" }], todo: [{ label: "Read", done: true }] });
    const html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Build the plan");
    expect(html).toContain("Analyst");
  });

  it("renders every dialog", () => {
    connect();
    const dialogs = [
      { kind: "adGroup" as const, campaignId: "c_running" },
      { kind: "keywords" as const },
      { kind: "negatives" as const, campaignId: "c_generic" },
      { kind: "ad" as const },
      { kind: "ad" as const, adGroupId: "ag_run_men", adId: "ad3" },
      { kind: "asset" as const },
      { kind: "budget" as const, campaignId: "c_running" },
      { kind: "audience" as const },
      { kind: "conversion" as const },
    ];
    for (const dialog of dialogs) {
      useGoogleAds.setState({ dialog });
      expect(() => renderToString(createElement(GaDialogs))).not.toThrow();
    }
  });

  it("renders the campaign editor for every type", () => {
    connect();
    const types: CampaignType[] = ["SEARCH", "PERFORMANCE_MAX", "SHOPPING", "DISPLAY", "VIDEO", "DEMAND_GEN"];
    for (const type of types) {
      const b = emptyBundle();
      b.campaign.type = type;
      useGoogleAds.setState({ editor: { open: true, draft: b } });
      expect(renderToString(createElement(GaCampaignEditor))).toContain("Review your campaign");
    }
    useGoogleAds.setState({ editor: { open: true } });
    expect(renderToString(createElement(GaCampaignEditor))).toContain("goal of this campaign");
  });
});

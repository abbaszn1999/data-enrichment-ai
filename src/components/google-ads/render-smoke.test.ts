import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { activeChatOf, useGoogleAds } from "@/lib/google-ads/store";
import { planAgentTurn } from "@/lib/google-ads/agent-sim";
import { DEFAULT_PROFILE, emptyProfile, profileCompleteness } from "@/lib/google-ads/docs";
import type { CampaignType, GaView } from "@/lib/google-ads/types";
import { GoogleAdsShell } from "./ga-shell";
import { GaDialogs } from "./ga-dialogs";
import { GaCampaignEditor } from "./ga-campaign-editor";
import { emptyBundle } from "@/lib/google-ads/mutations";

// Server rendering reads zustand's initial state; make it read the live state instead.
const originalUseSyncExternalStore = React.useSyncExternalStore;
(React as { useSyncExternalStore: typeof React.useSyncExternalStore }).useSyncExternalStore = (subscribe, getSnapshot) =>
  originalUseSyncExternalStore(subscribe, getSnapshot, getSnapshot);

const VIEWS: GaView[] = ["overview", "campaigns", "adGroups", "ads", "assets", "keywords", "negatives", "searchTerms", "audiences", "locations", "schedule", "devices", "recommendations", "conversions", "library", "settings", "pending", "history", "products", "productGroups", "reports", "rules", "keywordPlanner", "experiments", "planner", "content", "demographics", "links", "accountSettings", "documents", "profile", "connections"];

/** The HTML of one landmark (the sidebar or the page), so assertions ignore the chat panel and top bar. */
const part = (html: string, tag: string) => html.slice(html.indexOf("<" + tag), html.indexOf("</" + tag + ">"));

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

  it("shows the agent as a fixed panel with chat tabs and the Store Agent message box", () => {
    connect();
    const html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("New chat");
    expect(html).toContain("History");
    expect(html).toContain("Plan");
    expect(html).toContain("Ask anything about");
    // There is no way to hide the agent.
    expect(html).not.toContain("Hide agent");
    expect(html).not.toContain("Open agent");
  });

  it("keeps several chats as tabs: new, switch, close, rename, pin, delete", () => {
    connect();
    const acc = () => {
      const s = useGoogleAds.getState();
      return s.accounts[s.customerId!]!;
    };
    const first = acc().activeChatId;
    expect(acc().openChatIds).toEqual([first]);

    // The first question names the chat.
    useGoogleAds.getState().addMessage({ id: "m1", role: "user", text: "Where am I wasting budget?", at: "" });
    expect(acc().chats.find((c) => c.id === first)!.title).toBe("Where am I wasting budget?");

    // + opens a fresh chat; pressing + again reuses the empty one.
    useGoogleAds.getState().newChat();
    const second = acc().activeChatId;
    expect(second).not.toBe(first);
    expect(acc().openChatIds).toEqual([first, second]);
    useGoogleAds.getState().newChat();
    expect(acc().openChatIds).toHaveLength(2);

    // Each chat keeps its own messages; patching finds a message in any chat.
    useGoogleAds.getState().addMessage({ id: "m2", role: "user", text: "Write a monthly report", at: "" });
    expect(acc().chats.find((c) => c.id === second)!.messages).toHaveLength(1);
    expect(acc().chats.find((c) => c.id === first)!.messages).toHaveLength(1);
    useGoogleAds.getState().patchMessage("m1", { text: "edited" });
    expect(acc().chats.find((c) => c.id === first)!.messages[0]!.text).toBe("edited");

    useGoogleAds.getState().selectChat(first);
    expect(acc().activeChatId).toBe(first);
    useGoogleAds.getState().renameChat(second, "Monthly report");
    useGoogleAds.getState().pinChat(second);
    expect(acc().chats.find((c) => c.id === second)).toMatchObject({ title: "Monthly report", pinned: true });
    expect(renderToString(createElement(GoogleAdsShell))).toContain("Monthly report");

    // Closing a tab keeps the chat in History; opening it from there brings it back.
    useGoogleAds.getState().closeChat(second);
    expect(acc().openChatIds).toEqual([first]);
    expect(acc().chats.some((c) => c.id === second)).toBe(true);
    useGoogleAds.getState().openChat(second);
    expect(acc().activeChatId).toBe(second);

    // Deleting removes it for good; the last chat is never left empty-handed.
    useGoogleAds.getState().deleteChat(second);
    expect(acc().chats.some((c) => c.id === second)).toBe(false);
    useGoogleAds.getState().deleteChat(first);
    expect(acc().chats).toHaveLength(1);
    expect(acc().openChatIds).toEqual([acc().activeChatId]);
  });

  it("plan mode describes the work and prepares nothing to approve", () => {
    connect();
    useGoogleAds.getState().setChatMode("plan");
    const s = useGoogleAds.getState();
    expect(activeChatOf(s.accounts[s.customerId!]!).mode).toBe("plan");
    const html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Nothing in the account will change");
  });

  it("shows the agreed account-level sidebar and nothing the agent should do", () => {
    connect();
    useGoogleAds.setState({ scope: {}, view: "overview" });
    const page = renderToString(createElement(GoogleAdsShell));
    // No Pending button in the top bar either: approvals happen in the chat.
    expect(page).not.toContain('title="Pending changes"');
    const html = part(page, "nav");
    for (const label of ["Recommendations", "Reports", "Campaigns", "Ad groups", "Ads", "Experiments", "Assets", "Keywords", "Audiences", "Placements &amp; content", "Locations &amp; schedule", "Shared library", "Conversions", "Linked accounts", "Connections", "Account settings", "Documents", "Business profile", "Rules &amp; alerts"]) {
      expect(html, label).toContain(label);
    }
    // Moved into tabs, or left to the agent and the chat.
    for (const label of ["Negative keywords", "Demographics", "Keyword Planner", "Performance Planner", "Pending changes", "Change history", ">Products<"]) {
      expect(html, label).not.toContain(label);
    }
  });

  it("groups related pages into tabs: Keywords, Audiences, Locations & schedule", () => {
    connect();
    const tabsOf = (view: GaView, scope = {}) => {
      useGoogleAds.setState({ scope, view });
      return renderToString(createElement(GoogleAdsShell));
    };
    let html = tabsOf("searchTerms");
    expect(html).toContain('role="tablist"');
    for (const t of ["Search keywords", "Negative keywords", "Search terms"]) expect(html).toContain(t);
    html = tabsOf("demographics");
    for (const t of ["Audiences", "Demographics"]) expect(html).toContain(t);
    html = tabsOf("schedule");
    for (const t of ["Locations", "Ad schedule", "Devices"]) expect(html).toContain(t);
    // Overview has no tab strip.
    expect(tabsOf("overview")).not.toContain('role="tablist"');
    // Performance Max has no positive keywords, so Search keywords disappears from the tabs.
    const pmax = useGoogleAds.getState().accounts["7316204458"]!.data.campaigns.find((c) => c.type === "PERFORMANCE_MAX")!;
    html = tabsOf("negatives", { campaignId: pmax.id });
    expect(html).toContain("Negative keywords");
    expect(html).not.toContain("Search keywords");
  });

  it("splits Shared library and account ad groups into tabs", () => {
    connect();
    useGoogleAds.setState({ scope: {}, view: "library" });
    let html = renderToString(createElement(GoogleAdsShell));
    for (const t of ["Budgets", "Bid strategies", "Negative lists", "Placement exclusions", "Labels"]) expect(html).toContain(t);
    expect(html).toContain("Every budget in the account");
    useGoogleAds.setState({ scope: {}, view: "adGroups" });
    html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Asset groups");
  });

  it("builds the Shared library from real objects: portfolio strategies, placement lists, labels", () => {
    connect();
    const data = useGoogleAds.getState().accounts["7316204458"]!.data;
    // A portfolio strategy exists as its own object and campaigns point at it.
    expect(data.bidStrategies.length).toBeGreaterThan(0);
    for (const s of data.bidStrategies) {
      expect(data.campaigns.some((c) => c.bidding.portfolioId === s.id), s.name).toBe(true);
    }
    // A campaign's own strategy (no portfolioId) is not a library item.
    expect(data.campaigns.some((c) => !c.bidding.portfolioId)).toBe(true);
    // Placement exclusion lists are named lists attached to real campaigns.
    for (const l of data.placementLists) {
      expect(l.placements.length).toBeGreaterThan(0);
      expect(l.campaignIds.every((id) => data.campaigns.some((c) => c.id === id))).toBe(true);
    }
    // Labels sit on more than campaigns.
    expect(data.adGroups.some((g) => g.labels?.length)).toBe(true);
    expect(data.keywords.some((k) => k.labels?.length)).toBe(true);
    // The empty account has none of it.
    connect("9082215570");
    const empty = useGoogleAds.getState().accounts["9082215570"]!.data;
    expect([empty.bidStrategies, empty.placementLists, empty.labelDefs].every((x) => x.length === 0)).toBe(true);
  });

  it("recommendations are asked of the agent, not applied from the dashboard", () => {
    connect();
    useGoogleAds.setState({ scope: {}, view: "recommendations" });
    const html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Ask agent to apply");
    expect(html).toContain("Ask agent to explain");
    expect(html).not.toContain("Dismiss");
  });

  it("has no manual add, edit or experiment buttons: the user asks the agent", () => {
    connect();
    const page = (view: GaView) => {
      useGoogleAds.setState({ scope: {}, view });
      return part(renderToString(createElement(GoogleAdsShell)), "main");
    };
    const button = (label: string) => new RegExp(`</svg>\\s*${label}</button>`);
    expect(page("campaigns")).not.toContain("New campaign");
    expect(page("adGroups")).not.toMatch(button("Ad group"));
    const ads = page("ads");
    expect(ads).not.toContain("Write ads with agent");
    expect(ads).not.toMatch(button("Ad"));
    expect(ads).not.toMatch(button("Edit"));
    expect(ads).toContain("Fix with agent");
    const experiments = page("experiments");
    for (const t of ["New experiment", "Apply to campaign", "End experiment", "Start experiment"]) expect(experiments, t).not.toContain(t);
    expect(experiments).toContain("Confidence");
    // Keywords keeps the agent shortcuts and loses the manual add buttons.
    const keywords = page("keywords");
    expect(keywords).toContain("Keyword ideas");
    expect(keywords).not.toMatch(button("Keywords"));
    const negatives = page("negatives");
    expect(negatives).toContain("Find waste");
    expect(negatives).not.toMatch(button("Negative keywords"));
    expect(page("searchTerms")).toMatch(/Analy[sz]e with agent/);
    expect(negatives).not.toContain('aria-label="Remove"');
  });

  it("targeting and measurement pages are read-only", () => {
    connect();
    const render = (view: GaView, campaignId?: string) => {
      useGoogleAds.setState({ scope: campaignId ? { campaignId } : {}, view });
      return part(renderToString(createElement(GoogleAdsShell)), "main");
    };
    const campaignId = useGoogleAds.getState().accounts && Object.values(useGoogleAds.getState().accounts)[0]?.data.campaigns[0]?.id;
    const views: GaView[] = ["audiences", "demographics", "content", "locations", "schedule", "devices", "conversions"];
    for (const v of views) {
      for (const html of [render(v), render(v, campaignId)]) {
        expect(html, v).not.toContain("<input");
        // A <select> is allowed: it is the campaign picker (a view filter), not an editor.
        expect(html, v).not.toContain('aria-label="Remove"');
        expect(html, v).not.toMatch(/<button[^>]*role="switch"/);
        for (const t of ["Add segment", "Add exclusion", "Add targeting", "Add rule", "Upload a CSV"]) expect(html, `${v}: ${t}`).not.toContain(t);
        expect(html, v).not.toMatch(/>(All day|8:00[^<]*|Conversion action)<\/button>/);
      }
    }
    expect(render("content")).toMatch(/Find bad placements/);
    expect(render("conversions")).toMatch(/Check tracking/);
    // Rules & alerts: rules are created by the agent, there is no manual "New rule".
    const rules = render("rules");
    expect(rules).not.toContain("New rule");
    expect(rules).toContain("Let the agent set it up");
  });

  it("business profile is a read-only knowledge base the agent fills", () => {
    connect();
    useGoogleAds.setState({ scope: {}, view: "profile" });
    let html = renderToString(createElement(GoogleAdsShell));
    for (const t of ["Read-only", "Knowledge base", "Markets &amp; catalog", "Economics", "Positioning", "Guardrails", "Brand guidelines", "Competitors", "Never advertise", "Peak seasons", "Key selling points", "Stride Violet", "Break-even"]) {
      expect(html, t).toContain(t);
    }
    expect(html).toMatch(/6(<!-- -->)? of (<!-- -->)?6(<!-- -->)? sections filled/);
    const page = part(html, "main");
    expect(page).not.toContain("Save profile");
    expect(page).not.toContain("<input");
    expect(page).not.toContain("<textarea");

    // Before onboarding the agent has filled nothing yet.
    useGoogleAds.getState().setProfile(emptyProfile("Stride"));
    html = renderToString(createElement(GoogleAdsShell));
    expect(html).toContain("Not filled yet");
    expect(html).toMatch(/0(<!-- -->)? of (<!-- -->)?6(<!-- -->)? sections filled/);
  });

  it("measures how complete the business profile is", () => {
    expect(profileCompleteness(DEFAULT_PROFILE)).toMatchObject({ done: 6, total: 6 });
    const none = profileCompleteness(emptyProfile());
    expect(none.done).toBe(0);
    const partial = profileCompleteness({ ...emptyProfile("Shop"), website: "https://shop.example", markets: ["UAE"], categories: ["Shoes"] });
    expect(partial.sections.filter((s) => s.filled).map((s) => s.id)).toEqual(["business", "markets"]);
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

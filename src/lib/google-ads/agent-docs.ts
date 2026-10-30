// Agent document generators and editors. Each generator reads the account,
// the business profile and memory, and returns a typed document. Edits and
// comment replies produce new versions of an existing document.

import { catalogFix, forecastCampaign, keywordIdeas, productMetrics, segmentRows } from "./analytics";
import { DESCRIPTIONS, HEADLINES, audit, budget as budgetPlan, parseCreate, themeOf, waste, wastedTerms, type AgentPlan, type Ctx } from "./agent-sim";
import { CAMPAIGN_TYPES } from "./constants";
import {
  DEFAULT_PROFILE,
  DOC_TYPES,
  newDoc,

  section,
  type AgentDoc,
  type BusinessProfile,
  type ChecklistItem,
  type DocComment,
  type DocSection,
  type DocType,
} from "./docs";
import { accountBase, addDays, campaignBase, delta, derive, money, num, pct, previousRange, rangeFor } from "./metrics";
import { gid } from "./mutations";
import type { AccountData, AutomatedRule, Experiment, MutateOp, ScheduledReport } from "./types";

const profileOf = (ctx: Ctx): BusinessProfile => ctx.profile ?? DEFAULT_PROFILE;
const memoryHint = (ctx: Ctx, re: RegExp) => ctx.memories?.find((m) => re.test(m.text))?.text;

function moneyIn(text: string): number | undefined {
  const m = text.replace(/,/g, "").match(/\$\s?(\d+(?:\.\d+)?)\s?(k)?|(\d+(?:\.\d+)?)\s?(k)?\s?(?:\$|usd|dollars?|دولار)/i);
  if (!m) return undefined;
  const n = Number(m[1] ?? m[3]);
  return m[2] || m[4] ? n * 1000 : n;
}

function occasionOf(text: string): string {
  const t = text.toLowerCase();
  if (/ramadan|رمضان/.test(t)) return "Ramadan";
  if (/white friday|black friday|الجمعة البيضاء/.test(t)) return "White Friday";
  if (/back to school|المدارس/.test(t)) return "Back to School";
  if (/eid|العيد/.test(t)) return "Eid";
  if (/summer|الصيف/.test(t)) return "Summer";
  if (/launch|إطلاق|new product/.test(t)) return "Product Launch";
  return "Quarterly growth";
}

function exists(data: AccountData, op: MutateOp): boolean {
  if (op.kind === "budget.update") return data.budgets.some((b) => b.id === op.budgetId);
  if (op.kind === "keyword.create") return op.keywords.every((k) => data.adGroups.some((g) => g.id === k.adGroupId));
  if (op.kind === "ad.create") return op.ads.every((a) => data.adGroups.some((g) => g.id === a.adGroupId));
  return true;
}

function step(text: string, ops: MutateOp[] | undefined, detail?: string, risk: ChecklistItem["risk"] = "LOW"): ChecklistItem {
  return { id: gid("step"), text, ops, detail, risk };
}

// ─── Campaign plan ─────────────────────────────────────────────────────────

const PLAN_SPLIT = [
  { key: "brand", name: "Brand – Search (protect)", type: "SEARCH" as const, share: 0.1, roasK: 3.2 },
  { key: "search", name: "Search – Running & Gym", type: "SEARCH" as const, share: 0.3, roasK: 1 },
  { key: "pmax", name: "Performance Max – All Products", type: "PERFORMANCE_MAX" as const, share: 0.35, roasK: 0.85 },
  { key: "shopping", name: "Shopping – Gift Picks", type: "SHOPPING" as const, share: 0.15, roasK: 1.1 },
  { key: "remarketing", name: "Remarketing – Cart & Visitors", type: "DISPLAY" as const, share: 0.1, roasK: 1.3 },
];

export function buildPlanDoc(ctx: Ctx, inputs: { occasion: string; budget: number; goal: string; focus: string; weeks?: number }): AgentDoc {
  const { data, range } = ctx;
  const p = profileOf(ctx);
  const cur = data.account.currency;
  const base = derive(accountBase(data, range));
  // Blend recent results with the target so a strong month doesn't inflate the forecast.
  const baseRoas = base.roas ? (base.roas + p.targetRoas) / 2 : p.targetRoas;
  const seasonal = inputs.occasion === "Ramadan" ? 1.18 : inputs.occasion === "White Friday" ? 1.25 : 1.05;
  const weeks = inputs.weeks ?? (inputs.occasion === "Ramadan" ? 5 : 4);
  const days = weeks * 7;
  const breakEven = 1 / p.margin;
  const focusTheme = /gym|legging|apparel/i.test(inputs.focus) ? "gym" : "running";
  const hero = memoryHint(ctx, /hero product/i);

  const rows = PLAN_SPLIT.map((s) => {
    const spend = inputs.budget * s.share;
    const roas = Math.min(14, baseRoas * s.roasK * seasonal * (inputs.goal.startsWith("New") ? 0.85 : 1));
    return { ...s, spend, daily: spend / days, roas, value: spend * roas, conv: (spend * roas) / p.averageOrderValue };
  });
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalConv = rows.reduce((s, r) => s + r.conv, 0);
  const planRoas = totalValue / inputs.budget;

  const phases =
    inputs.occasion === "Ramadan"
      ? [
          { label: "Warm-up", when: "7 days before", focus: "Build remarketing lists, test new ads", items: ["Launch Ramadan ads at low budget", "Grow audiences: site visitors, video viewers"], budgetShare: 0.1 },
          { label: "Weeks 1–2", when: "Days 1–14", focus: "Steady demand, evening peaks", items: ["Bid +20% from 21:00 to 02:00", "Gift-guide sitelinks live"], budgetShare: 0.28 },
          { label: "Last 10 days", when: "Days 20–30", focus: "Peak Eid shopping", items: ["Raise budgets 40%", "Shipping-cut-off promotion asset"], budgetShare: 0.42 },
          { label: "Eid", when: "Eid + 3 days", focus: "Eid gifts and new outfits", items: ["Eid copy swap", "Remarketing to cart abandoners"], budgetShare: 0.2 },
        ]
      : [
          { label: "Prepare", when: "Week 1", focus: "Structure, assets and audiences", items: ["Build campaigns paused", "Approve ads and feed"], budgetShare: 0.15 },
          { label: "Launch", when: "Week 2", focus: "Go live and learn", items: ["Start at 80% budget", "Daily search-term review"], budgetShare: 0.25 },
          { label: "Scale", when: "Weeks 3–4", focus: "Move money to winners", items: ["Raise winners +30%", "Cut losers"], budgetShare: 0.6 },
        ];

  const t = HEADLINES[focusTheme];
  const ads = [
    { audience: "Shoppers buying for themselves", headlines: [`${inputs.occasion} Offers on ${focusTheme === "gym" ? "Gym Wear" : "Running Shoes"}`.slice(0, 30), t[3], t[1]], description: DESCRIPTIONS[focusTheme][0], url: "stride-demo.com/ramadan" },
    { audience: "Gift buyers", headlines: [`${inputs.occasion === "Ramadan" ? "Eid" : inputs.occasion} Gifts They'll Use`.slice(0, 30), "Gift Wrap & Fast Delivery", t[4]], description: "Thoughtful sportswear gifts, wrapped and delivered before Eid. Free returns.", url: "stride-demo.com/gifts" },
    { audience: "Night-time browsers (after iftar)", headlines: ["Shop After Iftar", hero ? "Glide 3: Our Best Seller" : t[0], t[2]], description: "Late-night delivery slots across Riyadh and Dubai. Order tonight, run tomorrow.", url: "stride-demo.com/new" },
  ];

  const daily = (k: string) => Math.round(rows.find((r) => r.key === k)!.daily);
  const searchBundle = parseCreate(`Create a Search campaign for ${focusTheme === "gym" ? "gym wear" : "running shoes"} in Saudi Arabia and UAE with $${daily("search")}/day`, data);
  searchBundle.campaign.name = `${inputs.occasion} – Search – ${focusTheme === "gym" ? "Gym Wear" : "Running"}`;
  searchBundle.budget.name = searchBundle.campaign.name;
  const pmaxBundle = parseCreate(`Create a Performance Max campaign for ${focusTheme === "gym" ? "gym wear" : "running shoes"} in Saudi Arabia and UAE with $${daily("pmax")}/day`, data);
  pmaxBundle.campaign.name = `${inputs.occasion} – PMax – All Products`;
  pmaxBundle.budget.name = pmaxBundle.campaign.name;

  const rule: AutomatedRule = { id: gid("rule"), name: `${inputs.occasion}: alert if daily spend passes $${Math.round((inputs.budget / days) * 1.3)}`, campaignIds: [], condition: { metric: "cost", op: ">", value: Math.round((inputs.budget / days) * 1.3), window: "TODAY" }, action: "NOTIFY", frequency: "HOURLY", enabled: true, createdBy: "AGENT" };
  const report: ScheduledReport = { id: gid("sr"), name: `${inputs.occasion} weekly report`, segment: "campaignType", metrics: ["cost", "conversions", "conversionsValue", "roas"], frequency: "WEEKLY", recipients: ["owner@stride-demo.com"], format: "PDF", nextRun: addDays(new Date().toISOString().slice(0, 10), 7) };

  const steps: ChecklistItem[] = [
    step(`Create "${searchBundle.campaign.name}" at ${money(daily("search"), cur)}/day`, [{ kind: "campaign.create", bundle: searchBundle, tempId: gid("c") }], "3 ad groups, keywords and ads from your catalog", "HIGH"),
    step(`Create "${pmaxBundle.campaign.name}" at ${money(daily("pmax"), cur)}/day`, [{ kind: "campaign.create", bundle: pmaxBundle, tempId: gid("c") }], "Asset group with images from Products Gallery", "HIGH"),
    step(`Raise Brand – Search to ${money(daily("brand"), cur)}/day`, [{ kind: "budget.update", budgetId: "b_brand", amount: daily("brand") }], "Protect brand searches when competitors bid on them", "MEDIUM"),
    step("Block seasonal searches that don't buy", [{ kind: "negative.create", negatives: ["imsakiya", "iftar time", "ramadan timings", "prayer times"].map((text) => ({ id: gid("n"), text, matchType: "PHRASE" as const, level: "CAMPAIGN" as const, parentId: "c_generic" })) }], "Prayer and iftar-time searches spike in Ramadan"),
    step("Turn on an overspend alert", [{ kind: "collection.upsert", collection: "rules", items: [rule] }], rule.name),
    step("Email a weekly progress report", [{ kind: "collection.upsert", collection: "scheduledReports", items: [report] }], "Every Monday to the owner"),
  ].map((s) => ({ ...s, ops: s.ops?.filter((o) => exists(data, o)) })).filter((s) => s.ops?.length);

  const sections: DocSection[] = [
    section(
      "Summary",
      { kind: "text", md: `A ${weeks}-week **${inputs.occasion}** plan with **${money(inputs.budget, cur)}** to drive **${inputs.goal}**, focused on **${inputs.focus}**. Built from your last 30 days (${(base.roas || p.targetRoas).toFixed(2)}× ROAS), your business profile and what worked before.` },
      {
        kind: "kpis",
        items: [
          { label: "Total budget", value: money(inputs.budget, cur), hint: `${money(inputs.budget / days, cur)}/day average` },
          { label: "Expected revenue", value: money(totalValue, cur, { compact: true }) },
          { label: "Expected orders", value: num(totalConv, { decimals: 0 }) },
          { label: "Expected ROAS", value: `${planRoas.toFixed(2)}×`, hint: `Break-even ${breakEven.toFixed(2)}× at ${Math.round(p.margin * 100)}% margin` },
        ],
      }
    ),
    section(
      "Goal and assumptions",
      { kind: "text", md: `- **Goal:** ${inputs.goal}\n- **Markets:** ${p.markets.join(", ")}\n- **Seasonal lift:** +${Math.round((seasonal - 1) * 100)}% conversion rate vs a normal month\n- **Average order:** ${money(p.averageOrderValue, cur)}\n- **Target ROAS:** ${p.targetRoas}× (break-even ${breakEven.toFixed(2)}×)` },
      inputs.budget > p.monthlyBudgetCap
        ? { kind: "callout", tone: "warn", title: "Above your monthly cap.", text: `This plan spends ${money(inputs.budget, cur)}, above the ${money(p.monthlyBudgetCap, cur)} cap in your business profile. Confirm before launch.` }
        : { kind: "callout", tone: "good", title: "Within your limits.", text: `${money(inputs.budget, cur)} fits your ${money(p.monthlyBudgetCap, cur)} monthly cap.` }
    ),
    section(
      "Budget split",
      { kind: "chart", title: "Share of budget", variant: "donut", format: "money", data: rows.map((r) => ({ label: r.name, value: Math.round(r.spend) })) },
      {
        kind: "table",
        columns: ["Campaign", "Type", "Share", "Total", "Per day", "Expected ROAS"],
        align: ["left", "left", "right", "right", "right", "right"],
        rows: [
          ...rows.map((r) => [r.name, CAMPAIGN_TYPES[r.type].label, pct(r.share, 0), money(r.spend, cur), money(r.daily, cur), `${r.roas.toFixed(1)}×`]),
          ["Total", "", "100%", money(inputs.budget, cur), money(inputs.budget / days, cur), `${planRoas.toFixed(1)}×`],
        ],
        highlightLast: true,
      }
    ),
    section("Campaign structure", {
      kind: "tree",
      items: [
        { name: searchBundle.campaign.name, meta: `Search · ${money(daily("search"), cur)}/day · Maximize conversions`, children: searchBundle.adGroups.map((g) => ({ name: g.adGroup.name, meta: `${g.keywords.length} keywords`, chips: g.keywords.slice(0, 3).map((k) => k.text) })) },
        { name: pmaxBundle.campaign.name, meta: `Performance Max · ${money(daily("pmax"), cur)}/day · Max conv. value`, children: pmaxBundle.assetGroups.map((g) => ({ name: g.name, meta: `${g.headlines.length} headlines · ${g.imageUrls.length} images`, chips: g.searchThemes.slice(0, 3) })) },
        { name: "Brand – Search (existing)", meta: `Raise to ${money(daily("brand"), cur)}/day`, children: [{ name: "Brand – Core", meta: "Exact brand terms" }] },
        { name: "Shopping & Remarketing (existing)", meta: "Gift labels and cart abandoners", children: [{ name: "Gift picks", meta: "Custom label: gift" }, { name: "Cart abandoners 30d", meta: "Display" }] },
      ],
    }),
    section(
      "Messaging and ads",
      { kind: "text", md: `Tone from your brand voice: *${p.brandVoice}*${hero ? `\n\nFrom memory: ${hero}` : ""}` },
      { kind: "ads", items: ads }
    ),
    section("Timeline", { kind: "timeline", phases }),
    section(
      "Expected results",
      { kind: "chart", title: "Expected revenue by phase", variant: "bar", format: "money", data: phases.map((ph) => ({ label: ph.label, value: Math.round(totalValue * (ph.budgetShare ?? 0.25)) })) },
      {
        kind: "table",
        columns: ["Scenario", "Spend", "Revenue", "Orders", "ROAS"],
        align: ["left", "right", "right", "right", "right"],
        rows: [
          ["Conservative", money(inputs.budget * 0.9, cur), money(totalValue * 0.75, cur), num(totalConv * 0.75, { decimals: 0 }), `${((totalValue * 0.75) / (inputs.budget * 0.9)).toFixed(2)}×`],
          ["Expected", money(inputs.budget, cur), money(totalValue, cur), num(totalConv, { decimals: 0 }), `${planRoas.toFixed(2)}×`],
          ["Optimistic", money(inputs.budget, cur), money(totalValue * 1.2, cur), num(totalConv * 1.2, { decimals: 0 }), `${(planRoas * 1.2).toFixed(2)}×`],
        ],
      },
      { kind: "callout", tone: "info", title: "Forecasts are estimates.", text: "They use your recent results, seasonality and auction data. Actual results depend on competition and stock." }
    ),
    section(
      "Risks",
      { kind: "text", md: "- **Stock-outs** on hero sizes in the last 10 days. Keep the feed updated hourly.\n- **Rising CPCs** as competitors bid on Ramadan terms. The overspend alert covers this.\n- **Delivery cut-off** before Eid. Switch to gift cards in the final 48 hours." }
    ),
    section("Execution steps", { kind: "text", md: "Approve the plan, then run each step. Every step creates a change that waits in **Pending changes**." }, { kind: "checklist", items: steps }),
  ];

  return newDoc("PLAN", `${inputs.occasion} campaign plan`, sections, {
    subtitle: `${weeks} weeks · ${money(inputs.budget, cur)} · ${inputs.goal}`,
    team: ["Analyst", "Strategist", "Copywriter", "Forecaster"],
    inputs: { ...inputs, weeks },
  });
}

// ─── Performance report ────────────────────────────────────────────────────

export function buildReportDoc(ctx: Ctx, opts: { days?: 7 | 30 } = {}): AgentDoc {
  const { data } = ctx;
  const cur = data.account.currency;
  const range = rangeFor(opts.days === 7 ? "LAST_7_DAYS" : "LAST_30_DAYS");
  const now = derive(accountBase(data, range));
  const prev = derive(accountBase(data, previousRange(range)));
  const rows = data.campaigns.filter((c) => c.status !== "REMOVED").map((c) => ({ c, m: derive(campaignBase(data, c.id, range)) })).sort((a, b) => b.m.conversionsValue - a.m.conversionsValue);
  const best = rows[0];
  const worst = [...rows].filter((r) => r.m.cost > 100).sort((a, b) => a.m.roas - b.m.roas)[0];
  const devices = segmentRows(data, range, "device");
  const wasteChanges = waste({ ...ctx, range }).changes;
  const budgetChanges = budgetPlan({ ...ctx, range }).changes;
  const period = opts.days === 7 ? "Weekly" : "Monthly";
  const d = (k: "cost" | "conversions" | "conversionsValue" | "roas" | "cpa") => delta(now[k], prev[k]) ?? undefined;

  const sections: DocSection[] = [
    section(
      "Headline numbers",
      {
        kind: "kpis",
        items: [
          { label: "Spend", metric: "cost", delta: d("cost") },
          { label: "Orders", metric: "conversions", delta: d("conversions") },
          { label: "Revenue", metric: "conversionsValue", delta: d("conversionsValue") },
          { label: "ROAS", metric: "roas", delta: d("roas") },
          { label: "Cost per order", metric: "cpa", delta: d("cpa") },
        ],
      },
      { kind: "text", md: `Revenue ${(d("conversionsValue") ?? 0) >= 0 ? "grew" : "fell"} **${Math.abs((d("conversionsValue") ?? 0) * 100).toFixed(1)}%** on ${(d("cost") ?? 0) >= 0 ? "+" : ""}${((d("cost") ?? 0) * 100).toFixed(1)}% spend. ROAS is **${now.roas.toFixed(2)}×**, ${now.roas >= profileOf(ctx).targetRoas ? "above" : "below"} your ${profileOf(ctx).targetRoas}× target.` }
    ),
    section("Trend", { kind: "chart", title: "Spend and orders per day", variant: "line", format: "money", live: { metric: "cost", metric2: "conversions" }, seriesNames: ["Spend", "Orders"] }),
    section(
      "Campaigns",
      {
        kind: "table",
        columns: ["Campaign", "Type", "Spend", "Orders", "Revenue", "ROAS"],
        align: ["left", "left", "right", "right", "right", "right"],
        rows: rows.map(({ c, m }) => [c.name, CAMPAIGN_TYPES[c.type].short, money(m.cost, cur), num(m.conversions, { decimals: 0 }), money(m.conversionsValue, cur), m.cost ? `${m.roas.toFixed(2)}×` : "—"]),
      },
      { kind: "callout", tone: "good", title: `Winner: ${best.c.name}.`, text: `${money(best.m.conversionsValue, cur)} revenue at ${best.m.roas.toFixed(2)}×.` },
      ...(worst ? [{ kind: "callout" as const, tone: "bad" as const, title: `Weakest: ${worst.c.name}.`, text: `${worst.m.roas.toFixed(2)}× ROAS on ${money(worst.m.cost, cur)} spend.` }] : [])
    ),
    section("Devices", { kind: "chart", title: "Revenue by device", variant: "donut", format: "money", data: devices.map((r) => ({ label: r.label, value: Math.round(r.metrics.conversionsValue) })) }),
    section(
      "Wasted spend",
      { kind: "text", md: `${wastedTerms({ ...ctx, range }).length} search terms spent money with no orders. Details in **Search terms**.` }
    ),
    section(
      "Recommendations",
      {
        kind: "checklist",
        items: [...wasteChanges, ...budgetChanges].map((c) => step(c.title, c.ops, c.impact, c.risk)),
      }
    ),
  ];
  return newDoc("REPORT", `${period} performance report`, sections, {
    subtitle: `${range.start} → ${range.end} · ${data.account.name}`,
    team: ["Analyst", "Strategist"],
    inputs: { days: opts.days ?? 30 },
  });
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export function buildAuditDoc(ctx: Ctx): AgentDoc {
  const { data, range } = ctx;
  const cur = data.account.currency;
  const plan = audit(ctx);
  const wasted = wastedTerms(ctx);
  const wastedCost = wasted.reduce((s, w) => s + w.m.cost, 0);
  const issues = [
    { area: "Search terms", issue: `${wasted.length} terms spend with no orders`, impact: money(wastedCost, cur), severity: "High" },
    ...data.campaigns.filter((c) => c.status === "ENABLED" && c.servingIssues.includes("LIMITED_BY_BUDGET")).map((c) => ({ area: "Budget", issue: `${c.name} limited by budget`, impact: "Missed sales", severity: "High" })),
    ...data.ads.filter((a) => a.status === "ENABLED" && a.policy === "DISAPPROVED").map(() => ({ area: "Ads", issue: "Disapproved ad (claims, trademark)", impact: "Not serving", severity: "High" })),
    { area: "Ads", issue: `${data.ads.filter((a) => a.status === "ENABLED" && a.adStrength === "POOR").length} ads with Poor strength`, impact: "Lower CTR", severity: "Medium" },
    { area: "Keywords", issue: `${data.keywords.filter((k) => k.status === "ENABLED" && (k.qualityScore ?? 10) <= 4).length} keywords with Quality Score ≤ 4`, impact: "Higher CPC", severity: "Medium" },
    ...data.campaigns.filter((c) => c.type === "SEARCH" && c.networks.displayNetwork && c.status === "ENABLED").map((c) => ({ area: "Settings", issue: `${c.name} also runs on Display`, impact: "Low-intent clicks", severity: "Medium" })),
    { area: "Shopping feed", issue: `${data.products.filter((p) => p.status === "DISAPPROVED").length} disapproved products`, impact: "Products hidden", severity: data.products.some((p) => p.status === "DISAPPROVED") ? "High" : "Low" },
    { area: "Measurement", issue: `${data.conversions.filter((c) => c.status === "UNVERIFIED").length} unverified conversion action`, impact: "Calls not counted", severity: "Low" },
  ].filter((i) => !/^0 /.test(i.issue));
  const score = Math.max(38, 100 - issues.filter((i) => i.severity === "High").length * 9 - issues.filter((i) => i.severity === "Medium").length * 4 - Math.round(wastedCost / 80));

  const sections: DocSection[] = [
    section(
      "Health score",
      {
        kind: "score",
        score,
        label: score >= 80 ? "Healthy" : score >= 60 ? "Needs work" : "At risk",
        parts: [
          { label: "Budget & bidding", score: data.campaigns.some((c) => c.servingIssues.includes("LIMITED_BY_BUDGET")) ? 62 : 88 },
          { label: "Keywords & search terms", score: Math.max(35, 90 - wasted.length * 6) },
          { label: "Ads & assets", score: data.ads.some((a) => a.policy === "DISAPPROVED") ? 58 : 84 },
          { label: "Shopping feed", score: Math.max(40, 95 - data.products.filter((p) => p.issues.length).length * 5) },
          { label: "Measurement", score: data.conversions.some((c) => c.status === "UNVERIFIED") ? 76 : 95 },
        ],
      },
      { kind: "text", md: `**${issues.length} issues** found across ${data.campaigns.length} campaigns. About **${money((wastedCost / 30) * 30, cur)}/month** is going to searches that never buy.` }
    ),
    section("Issues by impact", { kind: "table", columns: ["Area", "Issue", "Impact", "Severity"], rows: issues.map((i) => [i.area, i.issue, i.impact, i.severity]) }),
    section("Fixes ready to apply", { kind: "checklist", items: plan.changes.map((c) => step(c.title, c.ops, c.impact, c.risk)) }),
    section("Needs your input", { kind: "text", md: "- Rewrite the disapproved ad (ask: *fix my disapproved ads*).\n- Verify the call-tracking tag on your site.\n- Replace the 2 Poor-strength ads (ask: *write better ads*)." }),
  ];
  return newDoc("AUDIT", "Account audit", sections, { subtitle: `${data.account.name} · ${range.start} → ${range.end}`, team: ["Auditor", "Analyst", "Feed specialist"] });
}

// ─── Budget plan ───────────────────────────────────────────────────────────

export function buildBudgetDoc(ctx: Ctx, total: number): AgentDoc {
  const { data, range } = ctx;
  const cur = data.account.currency;
  const live = data.campaigns.filter((c) => c.status === "ENABLED");
  const current = Object.fromEntries(live.map((c) => [c.id, data.budgets.find((b) => b.id === c.budgetId)?.amount ?? 0]));
  const alloc: Record<string, number> = Object.fromEntries(live.map((c) => [c.id, (current[c.id] * 30.4) * 0.5]));
  let left = total - Object.values(alloc).reduce((s, v) => s + v, 0);
  while (left > 50) {
    let bestId = live[0].id;
    let bestGain = -1;
    for (const c of live) {
      const a = forecastCampaign(data, c, range, alloc[c.id] / 30.4).value;
      const b = forecastCampaign(data, c, range, (alloc[c.id] + 100) / 30.4).value;
      if (b - a > bestGain) {
        bestGain = b - a;
        bestId = c.id;
      }
    }
    alloc[bestId] += 100;
    left -= 100;
  }
  const rows = live.map((c) => {
    const f = forecastCampaign(data, c, range, alloc[c.id] / 30.4);
    return { c, monthly: alloc[c.id], daily: alloc[c.id] / 30.4, now: current[c.id], f };
  });
  const totalValue = rows.reduce((s, r) => s + r.f.value, 0);
  const totalConv = rows.reduce((s, r) => s + r.f.conversions, 0);
  const sections: DocSection[] = [
    section(
      "Summary",
      { kind: "kpis", items: [{ label: "Monthly budget", value: money(total, cur) }, { label: "Expected revenue", value: money(totalValue, cur, { compact: true }) }, { label: "Expected orders", value: num(totalConv, { decimals: 0 }) }, { label: "Expected ROAS", value: `${(totalValue / total).toFixed(2)}×` }] },
      { kind: "text", md: "Each extra $100 went to the campaign where it buys the most revenue, so money flows to campaigns that are limited by budget and convert well, and away from ones with diminishing returns." }
    ),
    section("Split", { kind: "chart", title: "Monthly budget by campaign", variant: "donut", format: "money", data: rows.map((r) => ({ label: r.c.name, value: Math.round(r.monthly) })) }, {
      kind: "table",
      columns: ["Campaign", "Daily now", "Daily planned", "Monthly", "Expected revenue", "ROAS"],
      align: ["left", "right", "right", "right", "right", "right"],
      rows: rows.map((r) => [r.c.name, money(r.now, cur), money(r.daily, cur), money(r.monthly, cur), money(r.f.value, cur), `${(r.f.value / r.f.cost).toFixed(2)}×`]),
    }),
    section("Apply", { kind: "checklist", items: rows.filter((r) => Math.abs(r.daily - r.now) >= 1).map((r) => step(`Set ${r.c.name} to ${money(Math.round(r.daily), cur)}/day`, [{ kind: "budget.update", budgetId: r.c.budgetId, amount: Math.round(r.daily) }], `was ${money(r.now, cur)}/day`, r.daily > r.now * 1.5 ? "MEDIUM" : "LOW")) }),
  ];
  return newDoc("BUDGET", `Budget plan: ${money(total, cur)}/month`, sections, { subtitle: "Allocated by expected return per extra dollar", team: ["Forecaster", "Strategist"], inputs: { budget: total } });
}

// ─── Keyword research ──────────────────────────────────────────────────────

export function buildKeywordDoc(ctx: Ctx, seed: string): AgentDoc {
  const ideas = keywordIdeas(seed, { location: "Saudi Arabia", language: "English" });
  const cluster = (t: string) => (/buy|price|sale|cheap|online/.test(t) ? "Ready to buy" : /riyadh|dubai|near me/.test(t) ? "Local" : /best|review/.test(t) ? "Researching" : "Product");
  const groups = ["Ready to buy", "Product", "Local", "Researching"].map((g) => ({ g, items: ideas.filter((i) => cluster(i.text) === g) })).filter((x) => x.items.length);
  const target = ctx.data.adGroups.find((g) => g.type === "SEARCH_STANDARD" && themeOf(g.name) === themeOf(seed)) ?? ctx.data.adGroups.find((g) => g.type === "SEARCH_STANDARD");
  const buy = groups.find((x) => x.g === "Ready to buy")?.items ?? [];
  const pref = memoryHint(ctx, /phrase match/i);
  return newDoc("KEYWORDS", `Keyword research: ${seed}`, [
    section("Summary", { kind: "kpis", items: [{ label: "Keyword ideas", value: String(ideas.length) }, { label: "Monthly searches", value: num(ideas.reduce((s, i) => s + i.volume, 0), { compact: true }) }, { label: "Avg. top-of-page bid", value: money(ideas.reduce((s, i) => s + (i.bidLow + i.bidHigh) / 2, 0) / Math.max(1, ideas.length), "USD", { decimals: 2 }) }] }, ...(pref ? [{ kind: "callout" as const, tone: "info" as const, title: "From memory:", text: pref }] : [])),
    ...groups.map((x) => section(x.g, { kind: "table" as const, columns: ["Keyword", "Searches/mo", "Competition", "Bid range"], align: ["left", "right", "left", "right"] as ("left" | "right")[], rows: x.items.map((i) => [i.text, num(i.volume), i.competition.toLowerCase(), `${money(i.bidLow, "USD", { decimals: 2 })}–${money(i.bidHigh, "USD", { decimals: 2 })}`]) })),
    section("Recommended structure", { kind: "tree", items: [{ name: `Search – ${seed.replace(/\b\w/g, (c) => c.toUpperCase())}`, meta: "Maximize conversions", children: groups.filter((x) => x.g !== "Researching").map((x) => ({ name: x.g, meta: `${x.items.length} keywords`, chips: x.items.slice(0, 3).map((i) => i.text) })) }] }, { kind: "callout", tone: "warn", title: "Researching terms:", text: "add them as observation only or skip; they rarely buy on the first visit." }),
    section("Apply", { kind: "checklist", items: target && buy.length ? [step(`Add ${buy.length} ready-to-buy keywords to ${target.name} (phrase match)`, [{ kind: "keyword.create", keywords: buy.map((i) => ({ id: gid("k"), adGroupId: target.id, text: i.text, matchType: "PHRASE" as const, status: "ENABLED" as const, policy: "UNDER_REVIEW" as const })) }])] : [] }),
  ], { subtitle: "Saudi Arabia · English · Google Keyword Planner", team: ["Researcher", "Strategist"], inputs: { seed } });
}

// ─── Ad copy ───────────────────────────────────────────────────────────────

export function buildAdCopyDoc(ctx: Ctx, subject: string): AgentDoc {
  const theme = themeOf(subject);
  const p = profileOf(ctx);
  const h = HEADLINES[theme];
  const dsc = DESCRIPTIONS[theme];
  const target = ctx.data.adGroups.find((g) => g.type === "SEARCH_STANDARD" && themeOf(g.name) === theme);
  const audiences = theme === "gym" ? ["Women who train", "Gym regulars", "Gift buyers"] : ["Road runners", "Beginners", "Gift buyers"];
  return newDoc("ADCOPY", `Ad copy: ${subject}`, [
    section("Brief", { kind: "text", md: `**Product:** ${subject}\n\n**Voice:** ${p.brandVoice}` }),
    section("Ads by audience", { kind: "ads", items: audiences.map((a, i) => ({ audience: a, headlines: [h[(i * 3) % h.length], h[(i * 3 + 1) % h.length], h[(i * 3 + 2) % h.length]], description: dsc[i % dsc.length], url: `stride-demo.com/${theme}` })) }),
    section("All headlines", { kind: "table", columns: ["Headline", "Characters"], align: ["left", "right"], rows: h.map((x) => [x, `${x.length}/30`]) }, { kind: "table", columns: ["Description", "Characters"], align: ["left", "right"], rows: dsc.map((x) => [x, `${x.length}/90`]) }),
    section("Apply", { kind: "checklist", items: target ? [step(`Create a responsive search ad in ${target.name}`, [{ kind: "ad.create", ads: [{ id: gid("ad"), adGroupId: target.id, type: "RESPONSIVE_SEARCH_AD", status: "ENABLED", headlines: h.slice(0, 15).map((text) => ({ text })), descriptions: dsc.slice(0, 4).map((text) => ({ text })), finalUrl: `https://stride-demo.com/collections/${theme === "gym" ? "training" : theme}`, adStrength: "EXCELLENT", policy: "UNDER_REVIEW" }] }])] : [] }),
  ], { subtitle: `${audiences.length} audiences · ${h.length} headlines`, team: ["Copywriter"], inputs: { subject } });
}

// ─── Feed review ───────────────────────────────────────────────────────────

export function buildFeedDoc(ctx: Ctx): AgentDoc {
  const { data, range } = ctx;
  const metrics = productMetrics(data, range);
  const broken = data.products.filter((p) => p.issues.length);
  const fixable = broken.filter((p) => p.issues.some((i) => i.fixable));
  return newDoc("FEED", "Product feed review", [
    section("Status", { kind: "kpis", items: (["APPROVED", "LIMITED", "DISAPPROVED", "PENDING"] as const).map((s) => ({ label: s[0] + s.slice(1).toLowerCase(), value: String(data.products.filter((p) => p.status === s).length) })) }),
    section("Products with issues", { kind: "table", columns: ["Product", "Status", "Issue", "Fix", "Revenue (30d)"], rows: broken.map((p) => [p.title, p.status.toLowerCase(), p.issues.map((i) => i.detail).join(" "), p.issues.some((i) => i.fixable) ? "From catalog" : "Manual", money(metrics.get(p.id)?.conversionsValue ?? 0, data.account.currency)]) }),
    section("Apply", { kind: "checklist", items: fixable.length ? [step(`Fix ${fixable.length} products from your catalog`, [{ kind: "collection.upsert", collection: "products", items: fixable.map(catalogFix) }])] : [] }),
  ], { subtitle: `Merchant Center ${data.account.merchantCenterId ?? "not linked"}`, team: ["Feed specialist"] });
}

// ─── Competitors ───────────────────────────────────────────────────────────

const COMPETITOR_ROWS = [
  ["Nike", "71%", "38%", "Innovation, athletes", "Rarely mentions delivery"],
  ["Adidas", "58%", "29%", "Sales and bundles", "Discount-led, weak on heat"],
  ["Namshi", "64%", "44%", "Huge range, fast delivery", "Generic copy, no product story"],
  ["Noon", "49%", "51%", "Lowest price", "No expertise, mixed reviews"],
];

function competitorSections(): DocSection[] {
  return [
    section("Who you meet in the auction", { kind: "table", columns: ["Competitor", "Overlap rate", "Shows above you", "Their message", "Their weak spot"], rows: COMPETITOR_ROWS }, { kind: "callout", tone: "info", title: "Source:", text: "Auction insights (Google Ads UI) and Ads Transparency Center. Overlap is estimated for Running Shoes – Search." }),
    section("Your openings", { kind: "text", md: "- **Heat-tested comfort**: nobody else talks about Gulf summers.\n- **1–3 day delivery + 30-day returns**: beat Nike on service.\n- **Expert fit help**: Noon and Namshi can't match product knowledge." }),
  ];
}

export function buildCompetitorDoc(ctx: Ctx): AgentDoc {
  const p = profileOf(ctx);
  return newDoc("COMPETITORS", "Competitor analysis", [
    ...competitorSections(),
    section("Their ads", { kind: "ads", items: [
      { audience: "Namshi", headlines: ["Running Shoes Sale", "Up to 70% Off", "Free Delivery"], description: "Shop 500+ running shoes from top brands. Free delivery and returns.", url: "namshi.com" },
      { audience: "Noon", headlines: ["Running Shoes Deals", "Lowest Prices", "Express Delivery"], description: "Best deals on running shoes. Shop now and save.", url: "noon.com" },
    ] }),
    section("Actions", { kind: "checklist", items: [
      step("Create a custom audience of people searching competitor brands", [{ kind: "collection.upsert", collection: "audiences", items: [{ id: gid("aud"), name: "Competitor shoppers (custom)", kind: "CUSTOM", description: `People searching ${p.competitors.map((c) => c.name).join(", ")}` }] }]),
    ] }),
  ], { subtitle: `${p.competitors.map((c) => c.name).join(" · ")}`, team: ["Researcher", "Strategist", "Copywriter"] });
}

// ─── Experiment plan ───────────────────────────────────────────────────────

export function buildExperimentDoc(ctx: Ctx): AgentDoc {
  const { data } = ctx;
  const c = data.campaigns.find((x) => x.type === "SHOPPING") ?? data.campaigns[0];
  const exp: Experiment = { id: gid("exp"), name: `Target ROAS 450% on ${c.name}`, baseCampaignId: c.id, change: "Switch to Target ROAS 450%", ops: [{ kind: "campaign.update", campaignId: c.id, patch: { bidding: { type: "TARGET_ROAS", targetRoas: 4.5 } } }], split: 50, status: "RUNNING", startDate: new Date().toISOString().slice(0, 10), endDate: addDays(new Date().toISOString().slice(0, 10), 28) };
  return newDoc("EXPERIMENT", `Experiment: ${exp.name}`, [
    section("Hypothesis", { kind: "text", md: `Bidding to a **450% target ROAS** on ${c.name} will raise revenue per dollar by at least 8% without losing more than 5% of orders.` }),
    section("Design", { kind: "table", columns: ["Setting", "Value"], rows: [["Base campaign", c.name], ["Trial change", exp.change], ["Traffic split", "50 / 50"], ["Duration", "4 weeks"], ["Primary metric", "Conversion value / cost"], ["Guardrail", "Orders −5% max"]] }),
    section("Decide", { kind: "text", md: "- **Win:** ROAS +8% at ≥90% confidence → apply to the campaign.\n- **Lose or flat:** end it and keep the current strategy." }),
    section("Start", { kind: "checklist", items: [step("Start the experiment", [{ kind: "collection.upsert", collection: "experiments", items: [exp] }])] }),
  ], { subtitle: "4 weeks · 50/50 split", team: ["Strategist", "Analyst"] });
}

// ─── Seed ─────────────────────────────────────────────────────────────────

export function seedDocs(data: AccountData): AgentDoc[] {
  const ctx: Ctx = { data, range: rangeFor("LAST_7_DAYS"), scope: {} };
  const weekly = buildReportDoc(ctx, { days: 7 });
  weekly.title = "Weekly performance report";
  weekly.createdAt = weekly.updatedAt = new Date(Date.now() - 2 * 86400000).toISOString();
  weekly.schedule = { frequency: "WEEKLY", recipients: ["owner@stride-demo.com"], nextRun: addDays(new Date().toISOString().slice(0, 10), 5) };
  weekly.status = "APPROVED";
  return [weekly];
}

// ─── Editing ───────────────────────────────────────────────────────────────

type Edit = { sections: DocSection[]; note: string; reply: string; extra?: Partial<AgentDoc> };

function regenerate(doc: AgentDoc, ctx: Ctx, patch: Record<string, string | number>): AgentDoc | null {
  const inputs = { ...(doc.inputs ?? {}), ...patch };
  if (doc.type === "PLAN") return buildPlanDoc(ctx, { occasion: String(inputs.occasion ?? "Ramadan"), budget: Number(inputs.budget ?? 5000), goal: String(inputs.goal ?? "Sales"), focus: String(inputs.focus ?? "Running shoes"), weeks: Number(inputs.weeks ?? 5) });
  if (doc.type === "BUDGET") return buildBudgetDoc(ctx, Number(inputs.budget ?? 10000));
  return null;
}

/** Applies a request to a document; null when the request isn't an edit. */
export function editDoc(doc: AgentDoc, request: string, ctx: Ctx, onlySectionId?: string): Edit | null {
  const m = request.toLowerCase();
  const amount = moneyIn(request);
  const cur = ctx.data.account.currency;

  if (amount && (doc.type === "PLAN" || doc.type === "BUDGET") && /budget|ميزاني|make it|change|اجعل|غيّر|\$/.test(m)) {
    const next = regenerate(doc, ctx, { budget: amount });
    if (next) {
      const old = Number(doc.inputs?.budget ?? 0);
      return { sections: next.sections, note: `Budget ${money(old, cur)} → ${money(amount, cur)}`, reply: `Recalculated the whole plan for **${money(amount, cur)}**: the split, the forecast and the steps all follow.`, extra: { title: next.title, subtitle: next.subtitle, inputs: next.inputs } };
    }
  }

  if (doc.type === "PLAN" && /(week 1|first week|warm|الأسبوع الأول|البداية)/.test(m) && /(more|raise|increase|زِد|زد|ارفع|أكثر)/.test(m)) {
    const sections = doc.sections.map((s) =>
      s.blocks.some((b) => b.kind === "timeline")
        ? {
            ...s,
            blocks: s.blocks.map((b) => {
              if (b.kind !== "timeline") return b;
              const shares = b.phases.map((ph) => ph.budgetShare ?? 0.25);
              const moved = 0.08;
              const next = shares.map((v, i) => (i === 0 ? v + moved : i === shares.length - 1 ? v : v - moved / Math.max(1, shares.length - 2)));
              return { ...b, phases: b.phases.map((ph, i) => ({ ...ph, budgetShare: Math.max(0.05, next[i]) })) };
            }),
          }
        : s
    );
    return { sections, note: "More budget to the first phase", reply: "Moved **8% of the budget** into the first phase and took it evenly from the middle weeks. The last phase is unchanged." };
  }

  if (/short|summary only|مختصر|اختصر|أقصر/.test(m)) {
    const keep = doc.sections.filter((s, i) => i === 0 || /split|steps|apply|fixes|recommend|issues/i.test(s.title));
    return { sections: keep, note: "Shortened", reply: `Cut it down to **${keep.length} sections**: the summary, the numbers that matter and the steps.` };
  }

  if (/competitor|منافس/.test(m) && doc.type !== "COMPETITORS") {
    if (doc.sections.some((s) => s.title === "Who you meet in the auction")) return { sections: doc.sections, note: "No change", reply: "The competitor section is already in this document." };
    const idx = Math.max(1, doc.sections.length - 1);
    const sections = [...doc.sections.slice(0, idx), ...competitorSections(), ...doc.sections.slice(idx)];
    return { sections, note: "Added competitor analysis", reply: "Added **two sections on competitors**: who you meet in the auction and where you can beat them." };
  }

  if (/risk|مخاطر/.test(m) && !doc.sections.some((s) => s.title === "Risks")) {
    const idx = Math.max(1, doc.sections.length - 1);
    return { sections: [...doc.sections.slice(0, idx), section("Risks", { kind: "text", md: "- Rising CPCs in peak weeks.\n- Stock-outs on bestsellers.\n- Delivery cut-offs before holidays." }), ...doc.sections.slice(idx)], note: "Added risks", reply: "Added a **Risks** section." };
  }

  const remove = m.match(/(?:remove|delete|احذف|شيل)\s+(?:the\s+)?(.+?)(?:\s+section)?$/);
  if (remove) {
    const target = doc.sections.find((s) => s.title.toLowerCase().includes(remove[1].trim()) || remove[1].includes(s.title.toLowerCase()));
    if (target) return { sections: doc.sections.filter((s) => s.id !== target.id), note: `Removed "${target.title}"`, reply: `Removed the **${target.title}** section.` };
  }

  if (/(conservative|safer|أحذر|متحفظ)/.test(m) && doc.type === "PLAN") {
    const next = regenerate(doc, ctx, { budget: Math.round(Number(doc.inputs?.budget ?? 5000) * 0.8) });
    if (next) return { sections: next.sections, note: "Conservative version (−20% budget)", reply: "Made it more conservative: **20% less budget** with the same structure.", extra: { subtitle: next.subtitle, inputs: next.inputs } };
  }

  const improve = request.match(/improve the "(.+)" section/i);
  if (improve) {
    const target = doc.sections.find((s) => s.title === improve[1]);
    if (target) {
      const text = target.blocks.find((b) => b.kind === "text");
      const takeaway = text && text.kind === "text" ? text.md.replace(/[*_#>-]/g, "").split(/(?<=\.)\s/)[0] : `The numbers in "${target.title}" come from your last 30 days and your business profile.`;
      const sections = doc.sections.map((s) =>
        s.id === target.id
          ? { ...s, blocks: [{ kind: "callout" as const, tone: "good" as const, title: "Key takeaway:", text: takeaway }, ...s.blocks.filter((b) => !(b.kind === "callout" && b.title === "Key takeaway:")), { kind: "text" as const, md: "**What to watch:** check this weekly; I'll flag it in Rules & alerts if it drifts more than 15% from plan." }] }
          : s
      );
      return { sections, note: `Improved "${target.title}"`, reply: `Improved **${target.title}**: added a key takeaway at the top and what to watch.` };
    }
  }

  if (onlySectionId && /(clear|simpler|أبسط|وضّح)/.test(m)) {
    const sections = doc.sections.map((s) => (s.id === onlySectionId ? { ...s, blocks: [{ kind: "callout" as const, tone: "info" as const, title: "In short:", text: `This section explains ${s.title.toLowerCase()} in plain terms.` }, ...s.blocks] } : s));
    return { sections, note: "Simplified a section", reply: "Added a plain-language summary at the top of that section." };
  }
  return null;
}

const WHY: Record<string, string> = {
  "Budget split": "Brand protects cheap, high-intent sales; Performance Max and Search take most of the budget because they drove most revenue last month; remarketing stays small because the lists are limited.",
  "Expected results": "Revenue = spend × expected ROAS per campaign, using your last 30 days and a seasonal lift. Orders = revenue ÷ your average order value.",
  Timeline: "Spend follows demand: Gulf e-commerce peaks in the last 10 days before Eid, so that phase gets the biggest share.",
  "Health score": "Each high-severity issue costs 9 points, medium 4, and wasted spend lowers it further.",
};

export function replyToComment(doc: AgentDoc, comment: DocComment, ctx: Ctx): { reply: string; edit?: Edit } {
  const edit = editDoc(doc, comment.text, ctx, comment.sectionId);
  if (edit) return { reply: `${edit.reply} (version ${doc.version + 1})`, edit };
  const sec = doc.sections.find((s) => s.id === comment.sectionId);
  if (/why|how|لماذا|كيف/.test(comment.text.toLowerCase())) return { reply: WHY[sec?.title ?? ""] ?? `This is based on your last 30 days of data and your business profile (${Math.round(profileOf(ctx).margin * 100)}% margin, ${profileOf(ctx).targetRoas}× target ROAS).` };
  return { reply: "Noted. Tell me what to change here, for example *more budget to week 1*, *make it shorter* or *add risks*, and I'll update this section." };
}

// ─── Routing ───────────────────────────────────────────────────────────────

const TEAM_TASKS: Record<DocType, { role: string; task: string }[]> = {
  PLAN: [
    { role: "Analyst", task: "Reading last year's results and seasonality" },
    { role: "Strategist", task: "Splitting the budget and building the structure" },
    { role: "Copywriter", task: "Writing seasonal ads in your brand voice" },
    { role: "Forecaster", task: "Forecasting revenue and orders" },
  ],
  REPORT: [
    { role: "Analyst", task: "Comparing this period with the last one" },
    { role: "Strategist", task: "Turning findings into recommendations" },
  ],
  AUDIT: [
    { role: "Auditor", task: "Checking settings, keywords and ads" },
    { role: "Analyst", task: "Measuring wasted spend" },
    { role: "Feed specialist", task: "Checking Merchant Center products" },
  ],
  BUDGET: [
    { role: "Forecaster", task: "Modelling returns per extra dollar" },
    { role: "Strategist", task: "Allocating the budget" },
  ],
  KEYWORDS: [
    { role: "Researcher", task: "Pulling ideas and volumes" },
    { role: "Strategist", task: "Grouping by intent" },
  ],
  ADCOPY: [{ role: "Copywriter", task: "Writing headlines and descriptions" }],
  FEED: [{ role: "Feed specialist", task: "Reading product statuses" }],
  EXPERIMENT: [{ role: "Strategist", task: "Designing the test" }],
  COMPETITORS: [
    { role: "Researcher", task: "Reading auction overlap and competitor ads" },
    { role: "Copywriter", task: "Finding message gaps" },
  ],
};

function docPlan(doc: AgentDoc, reply: string, steps: string[]): AgentPlan {
  return {
    steps: steps.map((label, i) => ({ tool: ["ads_report", "profile_memory", "catalog_lookup", "ads_forecast", "doc_write"][i % 5], label })),
    todo: steps,
    team: TEAM_TASKS[doc.type],
    reply,
    changes: [],
    followUps: doc.type === "PLAN" ? ["Put more budget into week 1", "Add a competitor section", "Make it shorter"] : ["Make it shorter", "Add risks"],
    doc,
  };
}

function askPlanQuestions(occasion: string): AgentPlan {
  return {
    steps: [{ tool: "profile_memory", label: "Read your business profile and memory" }],
    reply: `Happy to build the **${occasion}** plan. Three quick questions so it fits your business:`,
    changes: [],
    followUps: [],
    questions: [
      { id: "budget", label: "Total budget", options: ["$3,000", "$5,000", "$10,000"] },
      { id: "goal", label: "Main goal", options: ["Sales at a strong ROAS", "New customers", "Clear stock"] },
      { id: "focus", label: "Products to push", options: ["Running shoes", "Gym wear", "All products"] },
    ],
  };
}

export function planDocTurn(message: string, ctx: Ctx): AgentPlan | null {
  const m = message.toLowerCase();
  const active = ctx.docs?.find((d) => d.id === ctx.activeDocId);

  const remember = message.match(/^(?:remember|تذكر|تذكّر|احفظ)\s*(?:that|أن)?\s*:?\s*(.+)/i);
  if (remember) return { steps: [{ tool: "memory_write", label: "Saved to the account memory" }], reply: `Saved. I'll use this from now on: *${remember[1]}*`, changes: [], followUps: [], memory: remember[1] };

  if (active) {
    const edit = editDoc(active, message, ctx);
    if (edit) {
      return {
        steps: [{ tool: "doc_read", label: `Read "${active.title}" (v${active.version})` }, { tool: "doc_update", label: edit.note }],
        reply: `${edit.reply} Saved as **version ${active.version + 1}**; changed sections are highlighted.`,
        changes: [],
        followUps: ["Make it shorter", "Add risks", "Add a competitor section"],
        docUpdate: { docId: active.id, sections: edit.sections, note: edit.note, extra: edit.extra },
      };
    }
  }

  if (!ctx.data.campaigns.length) return null;
  const answers = /^answers?\b|budget:\s*\$/i.test(message);
  const wantsPlan = /(plan|strategy|خطة|استراتيجي)/.test(m) && !/budget plan|spend \$|how to spend/.test(m);

  if (wantsPlan || answers) {
    const occasion = occasionOf(message);
    const budget = moneyIn(message);
    if (!budget) return askPlanQuestions(occasion);
    const goal = message.match(/goal:\s*([^·\n]+)/i)?.[1]?.trim() ?? "Sales at a strong ROAS";
    const focus = message.match(/focus:\s*([^·\n]+)/i)?.[1]?.trim() ?? (/gym|legging/.test(m) ? "Gym wear" : "Running shoes");
    const doc = buildPlanDoc(ctx, { occasion, budget, goal, focus });
    return docPlan(doc, `Your **${doc.title}** is open in a new tab: ${doc.sections.length} sections, a forecast and ${doc.sections.at(-1)?.blocks.find((b) => b.kind === "checklist")?.kind === "checklist" ? "steps you can run" : "next steps"}. Tell me what to change, or comment on any section.`, ["Read the last 30 days and seasonality", "Checked your business profile and memory", "Pulled hero products from the catalog", "Forecast revenue per campaign", "Wrote the plan document"]);
  }
  if (/(report|تقرير)/.test(m) && !/audit|تدقيق/.test(m)) {
    const doc = buildReportDoc(ctx, { days: /week|أسبوع/.test(m) ? 7 : 30 });
    return docPlan(doc, `Your **${doc.title}** is ready in a new tab. Want me to send it every Monday?`, ["Pulled account metrics", "Compared with the previous period", "Ranked campaigns", "Found recommendations", "Wrote the report"]);
  }
  if (/(audit|تدقيق)/.test(m) && /(report|document|doc|تقرير|مستند|write)/.test(m)) {
    const doc = buildAuditDoc(ctx);
    return docPlan(doc, `The audit is open in a new tab. Fixes are listed at the end; run them one by one or all at once.`, ["Checked settings and structure", "Measured wasted spend", "Checked ads and policy", "Checked the product feed", "Wrote the audit"]);
  }
  if (/(budget plan|how (should|do) i (split|spend)|spend \$|split \$|وزّع|توزيع)/.test(m)) {
    const doc = buildBudgetDoc(ctx, moneyIn(message) ?? 12000);
    return docPlan(doc, `The **${doc.title}** is open. Each extra $100 went where it earns the most.`, ["Read campaign returns", "Modelled diminishing returns", "Allocated the budget", "Wrote the plan"]);
  }
  if (/(keyword research|research keywords|ابحث عن كلمات|بحث كلمات)/.test(m)) {
    const seed = message.match(/(?:for|عن|ل)\s+(.+)$/i)?.[1]?.replace(/[?.!]$/, "") ?? "running shoes";
    const doc = buildKeywordDoc(ctx, seed);
    return docPlan(doc, `Keyword research for **${seed}** is open in a new tab, grouped by intent.`, ["Pulled keyword ideas", "Fetched volumes and bids", "Grouped by intent", "Wrote the document"]);
  }
  if (/(ad copy|write (ad )?copy|نصوص)/.test(m)) {
    const subject = message.match(/(?:for|لـ|ل)\s+(?:our\s+)?(.+)$/i)?.[1]?.replace(/[?.!]$/, "") ?? "running shoes";
    const doc = buildAdCopyDoc(ctx, subject);
    return docPlan(doc, `Ad copy for **${subject}** is open: ads per audience and every headline with its length.`, ["Read your brand voice", "Pulled product facts", "Wrote ads per audience", "Checked lengths and policy"]);
  }
  if (/(review (my )?(product )?feed|feed review|مراجعة المنتجات)/.test(m)) {
    const doc = buildFeedDoc(ctx);
    return docPlan(doc, "The feed review is open in a new tab.", ["Read Merchant Center statuses", "Matched products to the catalog", "Wrote the review"]);
  }
  if (/(competitor|منافس)/.test(m) && /(analy|تحليل|who)/.test(m)) {
    const doc = buildCompetitorDoc(ctx);
    return docPlan(doc, "The competitor analysis is open in a new tab.", ["Read auction insights", "Collected competitor ads", "Compared messages", "Wrote the analysis"]);
  }
  if (/(plan an experiment|experiment plan|خطة تجربة)/.test(m)) {
    const doc = buildExperimentDoc(ctx);
    return docPlan(doc, "The experiment plan is open. Start it from the last section.", ["Picked the campaign", "Designed the test", "Wrote the plan"]);
  }
  return null;
}

export { DOC_TYPES };

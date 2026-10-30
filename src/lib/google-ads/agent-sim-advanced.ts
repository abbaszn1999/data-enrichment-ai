// Agent scenarios for Shopping, reporting segments, monitoring, Performance
// Max assets, placements, demographics, experiments and forecasting. Same
// contract as agent-sim.ts: real analysis on the snapshot, applicable changes.

import { catalogFix, contentMetrics, forecastCampaign, productMetrics, segmentRows } from "./analytics";
import { WEEKDAYS } from "./constants";
import { money, num } from "./metrics";
import { gid } from "./mutations";
import type { AgentPlan } from "./agent-sim";
import type { AccountData, AdScheduleSlot, AutomatedRule, DateRange, GaScope, ListingGroup } from "./types";

type Ctx = { data: AccountData; range: DateRange; scope: GaScope };

export function fixProducts({ data }: Ctx): AgentPlan {
  const broken = data.products.filter((p) => p.issues.length);
  const fixable = broken.filter((p) => p.issues.some((i) => i.fixable));
  const manual = broken.filter((p) => p.issues.some((i) => !i.fixable));
  if (!broken.length)
    return { steps: [{ tool: "merchant_products", label: "Checked Merchant Center product statuses" }], reply: "Every product in Merchant Center is approved. Nothing to fix.", changes: [], followUps: ["Which products should I stop advertising?"], viewHint: "products" };
  return {
    steps: [
      { tool: "merchant_products", label: `Read ${data.products.length} products from Merchant Center`, detail: `${broken.length} with issues` },
      { tool: "catalog_lookup", label: "Matched them to your catalog", detail: "GTINs, clean titles, live prices" },
      { tool: "merchant_validate", label: "Checked the corrected data against feed rules" },
    ],
    reply: [
      `**${broken.length} products have Merchant Center issues.** ${broken.filter((p) => p.status === "DISAPPROVED").length} are disapproved and not serving at all.`,
      "",
      ...broken.map((p) => `- **${p.title}**: ${p.issues.map((i) => i.detail).join(" ")}`),
      "",
      fixable.length ? `I can fix **${fixable.length}** from your catalog data (GTIN, title, price) and resubmit them.` : "",
      manual.length ? `**${manual.length}** need you: images with overlays and health claims must be changed at the source.` : "",
    ].filter(Boolean).join("\n"),
    changes: fixable.length
      ? [
          {
            title: `Fix ${fixable.length} products from your catalog`,
            rationale: "Corrected GTINs, shortened titles and matched prices are sent back to Merchant Center for review.",
            impact: `${fixable.filter((p) => p.status === "DISAPPROVED").length} disapproved products can serve again`,
            risk: "LOW",
            ops: [{ kind: "collection.upsert", collection: "products", items: fixable.map(catalogFix) }],
          },
        ]
      : [],
    followUps: ["Which products should I stop advertising?", "How did my account perform in the last 30 days?"],
    viewHint: "products",
  };
}

export function excludeLosingProducts({ data, range }: Ctx): AgentPlan {
  const metrics = productMetrics(data, range);
  const shopping = data.campaigns.find((c) => c.type === "SHOPPING" && c.status !== "REMOVED");
  const root = data.listingGroups.find((g) => g.campaignId === shopping?.id && !g.parentId);
  const excluded = new Set(data.listingGroups.filter((g) => g.dimension === "ITEM_ID" && g.excluded).map((g) => g.value));
  const losers = data.products
    .map((p) => ({ p, m: metrics.get(p.id)! }))
    .filter(({ p, m }) => !excluded.has(p.id) && m.cost > 40 && m.roas < 1.5)
    .sort((a, b) => a.m.roas - b.m.roas)
    .slice(0, 5);
  if (!losers.length || !root)
    return { steps: [{ tool: "ads_report", label: "Ranked products by return on ad spend" }], reply: "Every product with meaningful spend returns at least 1.5×. Nothing worth excluding right now.", changes: [], followUps: ["Fix my Merchant Center product issues"], viewHint: "products" };
  const cur = data.account.currency;
  const total = losers.reduce((s, l) => s + l.m.cost, 0);
  const nodes: ListingGroup[] = losers.map(({ p }) => ({ id: gid("lg"), campaignId: root.campaignId, parentId: root.id, dimension: "ITEM_ID", value: p.id, excluded: true }));
  return {
    steps: [
      { tool: "ads_report", label: "Pulled shopping_performance_view by product" },
      { tool: "ads_report", label: "Compared each product's ROAS with the account" },
    ],
    reply: [
      `These **${losers.length} products** spent **${money(total, cur)}** at under 1.5× return:`,
      "",
      ...losers.map(({ p, m }) => `- ${p.title}: ${money(m.cost, cur)} spend, ${m.roas.toFixed(2)}× ROAS${p.benchmarkPrice && p.price > p.benchmarkPrice ? `, priced ${Math.round(((p.price - p.benchmarkPrice) / p.benchmarkPrice) * 100)}% above market` : ""}`),
      "",
      "Excluding them from Shopping moves that budget to products that sell. They stay in your store and in Performance Max.",
    ].join("\n"),
    changes: [
      {
        title: `Exclude ${losers.length} low-return products from Shopping`,
        rationale: `They cost ${money(total, cur)} with returns well below the account average.`,
        impact: `≈ ${money((total / 30) * 30, cur)}/month redirected to better products`,
        risk: "LOW",
        ops: [{ kind: "collection.upsert", collection: "listingGroups", items: nodes }],
      },
    ],
    followUps: ["Fix my Merchant Center product issues", "Should I move budget between campaigns?"],
    viewHint: "products",
  };
}

export function schedule(ctx: Ctx): AgentPlan {
  const { data, range } = ctx;
  const target = data.campaigns.find((c) => c.id === ctx.scope.campaignId && c.type === "SEARCH") ?? data.campaigns.find((c) => c.status === "ENABLED" && c.type === "SEARCH" && c.servingIssues.includes("LIMITED_BY_BUDGET")) ?? data.campaigns.find((c) => c.status === "ENABLED" && c.type === "SEARCH");
  const hours = segmentRows(data, range, "hour", target ? [target.id] : undefined).filter((r) => r.metrics.cost > 0);
  const days = segmentRows(data, range, "dayOfWeek", target ? [target.id] : undefined);
  if (!target || !hours.length) return { steps: [], reply: "There isn't enough Search data to judge hours yet.", changes: [], followUps: [] };
  const avg = hours.reduce((s, r) => s + r.metrics.roas, 0) / hours.length;
  const best = [...hours].sort((a, b) => b.metrics.roas - a.metrics.roas).slice(0, 3);
  const worst = [...hours].sort((a, b) => a.metrics.roas - b.metrics.roas).slice(0, 3);
  const bestDay = [...days].sort((a, b) => b.metrics.roas - a.metrics.roas)[0];
  const slots: AdScheduleSlot[] = WEEKDAYS.flatMap((day) => [
    { day, startHour: 6, endHour: 17 },
    { day, startHour: 17, endHour: 23, bidModifier: day === "THURSDAY" || day === "FRIDAY" ? 0.2 : 0.1 },
  ]);
  return {
    steps: [
      { tool: "ads_report", label: `Segmented ${target.name} by hour of day` },
      { tool: "ads_report", label: "Segmented by day of week" },
    ],
    reply: [
      `For **${target.name}**:`,
      "",
      `- **Best hours:** ${best.map((h) => `${h.label} (${h.metrics.roas.toFixed(1)}×)`).join(", ")}. Evenings convert best.`,
      `- **Worst hours:** ${worst.map((h) => `${h.label} (${h.metrics.roas.toFixed(1)}×)`).join(", ")}, against a ${avg.toFixed(1)}× average.`,
      `- **Best day:** ${bestDay.label} at ${bestDay.metrics.roas.toFixed(1)}×.`,
      "",
      "I suggest pausing ads from 23:00 to 06:00 and bidding +10% in the evening (+20% Thursday and Friday). With Smart Bidding the schedule still decides *when* ads run.",
    ].join("\n"),
    changes: [
      {
        title: `Ad schedule for ${target.name}`,
        rationale: "Night hours spend with the lowest return; evenings and the weekend convert best.",
        impact: "Typically +5–8% ROAS at similar volume",
        risk: "MEDIUM",
        ops: [{ kind: "campaign.update", campaignId: target.id, patch: { schedule: slots } }],
      },
    ],
    followUps: ["Compare mobile vs desktop and set device bid adjustments", "Which age groups and genders convert best?"],
    viewHint: "reports",
  };
}

export function devices({ data, range }: Ctx): AgentPlan {
  const rows = segmentRows(data, range, "device");
  const manual = data.campaigns.filter((c) => c.status === "ENABLED" && (c.bidding.type === "MANUAL_CPC" || c.bidding.type === "MAXIMIZE_CLICKS" || c.bidding.type === "TARGET_IMPRESSION_SHARE"));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.metrics]));
  const mobile = m["Mobile phones"];
  const desktop = m["Computers"];
  return {
    steps: [{ tool: "ads_report", label: "Segmented the account by device" }],
    reply: [
      `- **Mobile:** ${num(mobile.clicks)} clicks, ${mobile.roas.toFixed(2)}× ROAS, ${(mobile.convRate * 100).toFixed(2)}% conv. rate`,
      `- **Computers:** ${num(desktop.clicks)} clicks, ${desktop.roas.toFixed(2)}× ROAS, ${(desktop.convRate * 100).toFixed(2)}% conv. rate`,
      "",
      `Most traffic is mobile but computers convert ${(desktop.convRate / mobile.convRate).toFixed(1)}× better, typical for higher-priced shoes. ${manual.length ? `For campaigns that don't use conversion-based Smart Bidding (${manual.map((c) => c.name).join(", ")}) I'd bid computers up 20% and mobile down 10%.` : "All campaigns use Smart Bidding, which already adjusts by device, so no change is needed."}`,
    ].join("\n"),
    changes: manual.map((c) => ({
      title: `Device bids for ${c.name}`,
      rationale: "Computers convert much better than phones in this account.",
      impact: "Shifts spend toward the device that buys",
      risk: "LOW" as const,
      ops: [{ kind: "campaign.update" as const, campaignId: c.id, patch: { devices: { mobile: -0.1, desktop: 0.2, tablet: -0.2 } } }],
    })),
    followUps: ["When do my ads perform best? Adjust my ad schedule"],
    viewHint: "reports",
  };
}

export function demographics({ data, range }: Ctx): AgentPlan {
  const ages = segmentRows(data, range, "age");
  const genders = segmentRows(data, range, "gender");
  const weak = ages.filter((a) => a.metrics.roas < 1.2 && a.key !== "Unknown");
  const visual = data.campaigns.filter((c) => c.status !== "REMOVED" && (c.type === "DEMAND_GEN" || c.type === "DISPLAY"));
  const items = visual.flatMap((c) =>
    weak
      .filter((w) => !data.demographics.some((d) => d.campaignId === c.id && d.kind === "AGE" && d.value === w.key && d.excluded))
      .map((w) => {
        const existing = data.demographics.find((d) => d.campaignId === c.id && d.kind === "AGE" && d.value === w.key);
        return { ...(existing ?? { id: gid("dm"), campaignId: c.id, kind: "AGE" as const, value: w.key }), excluded: true };
      })
  );
  return {
    steps: [{ tool: "ads_report", label: "Segmented by age and gender" }],
    reply: [
      "**By age:**",
      ...ages.map((a) => `- ${a.label}: ${a.metrics.roas.toFixed(2)}× ROAS, ${num(a.metrics.conversions, { decimals: 0 })} conv.`),
      "",
      `**By gender:** ${genders.map((g) => `${g.label} ${g.metrics.roas.toFixed(2)}×`).join(", ")}.`,
      "",
      weak.length && items.length ? `${weak.map((w) => w.label).join(" and ")} barely buy. I'd exclude them from the visual campaigns (${visual.map((c) => c.name).join(", ")}), where demographic targeting matters most. Search keeps them, since search intent outweighs age.` : "No group is weak enough to exclude.",
    ].join("\n"),
    changes: items.length
      ? [{ title: `Exclude ${weak.map((w) => w.label).join(", ")} from ${visual.length} visual campaign${visual.length > 1 ? "s" : ""}`, rationale: "These ages convert at a fraction of the account average.", impact: "Less spend on audiences that don't buy", risk: "LOW", ops: [{ kind: "collection.upsert", collection: "demographics", items }] }]
      : [],
    followUps: ["Find placements that waste budget"],
    viewHint: "demographics",
  };
}

export function monitoring({ data }: Ctx): AgentPlan {
  const have = new Set(data.rules.map((r) => r.name));
  const candidates: AutomatedRule[] = [
    { id: gid("rule"), name: "Alert: campaign spends $100 with no conversions", campaignIds: [], condition: { metric: "cost", op: ">", value: 100, window: "TODAY" }, action: "NOTIFY", frequency: "HOURLY", enabled: true, createdBy: "AGENT" },
    { id: gid("rule"), name: "Alert: ROAS drops below 2× over 7 days", campaignIds: [], condition: { metric: "roas", op: "<", value: 2, window: "LAST_7_DAYS" }, action: "NOTIFY", frequency: "DAILY", enabled: true, createdBy: "AGENT" },
    { id: gid("rule"), name: "Alert: budget used up before 6 pm", campaignIds: [], condition: { metric: "budgetSpent", op: ">", value: 95, window: "TODAY" }, action: "NOTIFY", frequency: "HOURLY", enabled: true, createdBy: "AGENT" },
    { id: gid("rule"), name: "Pause keywords with CPA over 3× target (14 days)", campaignIds: data.campaigns.filter((c) => c.type === "SEARCH" && c.status === "ENABLED").map((c) => c.id), condition: { metric: "cpa", op: ">", value: 60, window: "LAST_7_DAYS" }, action: "PAUSE_KEYWORDS", frequency: "DAILY", enabled: true, createdBy: "AGENT" },
  ];
  const proposed = candidates.filter((r) => !have.has(r.name));
  return {
    steps: [
      { tool: "ads_get_structure", label: "Read campaigns, budgets and targets" },
      { tool: "ads_rules", label: `Checked ${data.rules.length} existing rules` },
    ],
    reply: proposed.length
      ? ["I'll watch the account for you with these rules. Alerts land in **Rules & alerts** and by email:", "", ...proposed.map((r) => `- ${r.name} (${r.frequency.toLowerCase()})`), "", "Only the last one acts on its own (pausing keywords); the rest just alert you. You can switch any of them off."].join("\n")
      : "Your monitoring already covers spend without conversions, ROAS drops and budget pacing.",
    changes: proposed.length ? [{ title: `Set up ${proposed.length} monitoring rules`, rationale: "Catches overspend, falling returns and budget pacing between your check-ins.", impact: "Problems surface within an hour instead of at the next review", risk: "LOW", ops: [{ kind: "collection.upsert", collection: "rules", items: proposed }] }] : [],
    followUps: ["Run a full audit of my account"],
    viewHint: "rules",
  };
}

const FRESH_HEADLINES = ["Built for 45°C Runs", "Ships Same Day in Riyadh", "4.8★ from 2,000 Runners", "Try 30 Days, Free Returns"];
const FRESH_DESCRIPTIONS = ["Breathable shoes and apparel tested in Gulf heat. Free delivery over $50.", "Rated 4.8 by 2,000+ runners. Order today and get it in 1–3 days."];

export function pmaxAssets({ data }: Ctx): AgentPlan {
  const groups = data.assetGroups.filter((g) => g.status === "ENABLED" && g.assetPerformance?.some((a) => a.rating === "LOW"));
  if (!groups.length) return { steps: [{ tool: "ads_asset_performance", label: "Checked asset ratings" }], reply: "No Performance Max asset is rated Low right now.", changes: [], followUps: [] };
  const changes: AgentPlan["changes"] = groups.map((g) => {
    const lowH = new Set(g.assetPerformance!.filter((a) => a.rating === "LOW" && a.kind === "HEADLINE").map((a) => a.text));
    const lowD = new Set(g.assetPerformance!.filter((a) => a.rating === "LOW" && a.kind === "DESCRIPTION").map((a) => a.text));
    const headlines = [...g.headlines.filter((h) => !lowH.has(h)), ...FRESH_HEADLINES.slice(0, Math.max(1, lowH.size + 1))];
    const descriptions = [...g.descriptions.filter((d) => !lowD.has(d)), ...FRESH_DESCRIPTIONS.slice(0, Math.max(1, lowD.size))];
    const assetPerformance = [
      ...g.assetPerformance!.filter((a) => a.rating !== "LOW" || (a.kind !== "HEADLINE" && a.kind !== "DESCRIPTION")),
      ...headlines.filter((h) => !g.headlines.includes(h)).map((text) => ({ kind: "HEADLINE" as const, text, rating: "LEARNING" as const })),
      ...descriptions.filter((d) => !g.descriptions.includes(d)).map((text) => ({ kind: "DESCRIPTION" as const, text, rating: "LEARNING" as const })),
    ];
    return {
      title: `Replace low-rated text in "${g.name}"`,
      rationale: `Swaps ${lowH.size + lowD.size} Low-rated text assets for new copy from your catalog and reviews.`,
      impact: "Low assets get fewer impressions; fresh ones are tested automatically",
      risk: "LOW" as const,
      ops: [{ kind: "assetGroup.update" as const, assetGroupId: g.id, patch: { headlines, descriptions, assetPerformance } }],
    };
  });
  const lowImages = groups.flatMap((g) => g.assetPerformance!.filter((a) => a.rating === "LOW" && a.kind === "IMAGE").map((a) => a.text));
  return {
    steps: [
      { tool: "ads_asset_performance", label: `Read asset ratings for ${groups.length} asset group${groups.length > 1 ? "s" : ""}` },
      { tool: "catalog_lookup", label: "Pulled product facts and review scores for new copy" },
    ],
    reply: [
      ...groups.map((g) => `**${g.name}:** ${g.assetPerformance!.filter((a) => a.rating === "LOW").map((a) => `"${a.text}"`).join(", ")} rated Low.`),
      "",
      `I wrote replacements that lean on proof (ratings, heat-tested, same-day delivery), which usually beats generic lines like "New Season Is Here".${lowImages.length ? ` ${lowImages.length} image${lowImages.length > 1 ? "s are" : " is"} also Low; I can generate new ones in Products Gallery.` : ""}`,
    ].join("\n"),
    changes,
    followUps: ["Fix my Merchant Center product issues"],
    viewHint: "adGroups",
  };
}

export function placements({ data, range }: Ctx): AgentPlan {
  const metrics = contentMetrics(data, range, data.contentTargets);
  const bad = data.contentTargets.filter((t) => !t.excluded && t.kind === "PLACEMENT").map((t) => ({ t, m: metrics.get(t.id)! })).filter(({ m }) => m.cost > 5 && m.conversions < 0.5);
  const cur = data.account.currency;
  if (!bad.length) return { steps: [{ tool: "ads_report", label: "Read the placements report" }], reply: "No placement is spending without converting.", changes: [], followUps: [], viewHint: "content" };
  return {
    steps: [{ tool: "ads_report", label: "Read group_placement_view", detail: `${data.contentTargets.length} placements` }],
    reply: [`**${bad.length} placements** spend without converting:`, "", ...bad.map(({ t, m }) => `- ${t.value.replace("mobileapp::", "App: ")}: ${money(m.cost, cur)}, ${num(m.clicks)} clicks, 0 conversions`), "", "Mobile game apps and content farms often produce accidental clicks. I'll exclude them."].join("\n"),
    changes: [{ title: `Exclude ${bad.length} placements`, rationale: "Spend with no conversions, typical of accidental in-app clicks.", impact: `≈ ${money(bad.reduce((s, b) => s + b.m.cost, 0), cur)} saved per period`, risk: "LOW", ops: [{ kind: "collection.upsert", collection: "contentTargets", items: bad.map(({ t }) => ({ ...t, excluded: true })) }] }],
    followUps: ["Which age groups and genders convert best?"],
    viewHint: "content",
  };
}

export function experiments({ data }: Ctx): AgentPlan {
  const running = data.experiments.filter((e) => e.status === "RUNNING");
  const winner = running.find((e) => e.result && e.result.confidence >= 0.9 && e.result.roas > 0 && e.ops.length);
  return {
    steps: [{ tool: "ads_experiments", label: `Read ${data.experiments.length} experiments` }],
    reply: data.experiments.length
      ? [
          ...data.experiments.map((e) => `- **${e.name}** (${e.status.toLowerCase()}): ${e.result ? `conversions ${e.result.conversions >= 0 ? "+" : ""}${(e.result.conversions * 100).toFixed(0)}%, ROAS ${e.result.roas >= 0 ? "+" : ""}${(e.result.roas * 100).toFixed(0)}% at ${Math.round(e.result.confidence * 100)}% confidence` : "collecting data"}`),
          "",
          winner ? `**${winner.name}** is a clear win. I can apply the change to the original campaign and end the test.` : "No experiment is ready to apply yet.",
        ].join("\n")
      : "You have no experiments. A good first one: test Target ROAS on Shopping against the current strategy for 4 weeks.",
    changes: winner
      ? [{ title: `Apply winning experiment: ${winner.name}`, rationale: winner.change, impact: `+${Math.round(winner.result!.roas * 100)}% ROAS in the test`, risk: "MEDIUM", ops: [...winner.ops, { kind: "collection.upsert", collection: "experiments", items: [{ ...winner, status: "APPLIED" }] }] }]
      : [],
    followUps: ["What if I increase my budget by 50%?"],
    viewHint: "experiments",
  };
}

export function forecast({ data, range, scope }: Ctx, message: string): AgentPlan {
  const pct = Number(message.match(/(\d+)\s?%/)?.[1] ?? 50) / 100;
  const campaigns = data.campaigns.filter((c) => c.status === "ENABLED" && (!scope.campaignId || c.id === scope.campaignId));
  const cur = data.account.currency;
  let now = { cost: 0, conv: 0, value: 0 };
  let next = { cost: 0, conv: 0, value: 0 };
  const lines: string[] = [];
  for (const c of campaigns) {
    const budget = data.budgets.find((b) => b.id === c.budgetId)?.amount ?? 0;
    const a = forecastCampaign(data, c, range, budget);
    const b = forecastCampaign(data, c, range, budget * (1 + pct));
    now = { cost: now.cost + a.cost, conv: now.conv + a.conversions, value: now.value + a.value };
    next = { cost: next.cost + b.cost, conv: next.conv + b.conversions, value: next.value + b.value };
    lines.push(`- ${c.name}: +${num(b.conversions - a.conversions, { decimals: 0 })} conv. for +${money(b.cost - a.cost, cur)}/mo${c.servingIssues.includes("LIMITED_BY_BUDGET") ? " (limited by budget, best use of extra money)" : ""}`);
  }
  return {
    steps: [{ tool: "ads_forecast", label: `Forecast ${campaigns.length} campaigns at +${Math.round(pct * 100)}% budget` }],
    reply: [
      `With **+${Math.round(pct * 100)}% budget** across ${campaigns.length} campaigns, the next 30 days look like:`,
      "",
      `- **Spend:** ${money(now.cost, cur)} → ${money(next.cost, cur)}`,
      `- **Conversions:** ${num(now.conv, { decimals: 0 })} → ${num(next.conv, { decimals: 0 })} (+${(((next.conv - now.conv) / (now.conv || 1)) * 100).toFixed(0)}%)`,
      `- **ROAS:** ${(now.value / (now.cost || 1)).toFixed(2)}× → ${(next.value / (next.cost || 1)).toFixed(2)}×`,
      "",
      ...lines,
      "",
      "Returns fall as budget grows, so the extra money works best in campaigns that are limited by budget. Open **Performance Planner** to try other amounts.",
    ].join("\n"),
    changes: [],
    followUps: ["Should I move budget between campaigns?"],
    viewHint: "planner",
  };
}

/** Routes advanced intents; returns null so the base router handles the rest. */
export function planAdvanced(message: string, ctx: Ctx): AgentPlan | null {
  const m = message.toLowerCase();
  if (/merchant|product issue|disapproved product|feed/.test(m)) return fixProducts(ctx);
  if (/stop advertising|losing product|exclude product|products? (that )?(don't|do not) sell/.test(m)) return excludeLosingProducts(ctx);
  if (/schedule|best hours?|time of day|perform best/.test(m)) return schedule(ctx);
  if (/device|mobile|desktop/.test(m)) return devices(ctx);
  if (/age|gender|demograph/.test(m)) return demographics(ctx);
  if (/monitor|alert|watch my|rules?\b/.test(m)) return monitoring(ctx);
  if (/pmax asset|performance max asset|weak asset|low asset|asset (rating|performance)/.test(m)) return pmaxAssets(ctx);
  if (/placement|apps? (that )?waste|where (my )?ads show/.test(m)) return placements(ctx);
  if (/experiment|a\/b|test /.test(m)) return experiments(ctx);
  if (/what if|forecast|increase (my )?budget|budget by \d+/.test(m)) return forecast(ctx, message);
  return null;
}

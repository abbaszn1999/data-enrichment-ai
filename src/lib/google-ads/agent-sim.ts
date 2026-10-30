// Scripted stand-in for the Google Ads agent. It reads the same account data
// the UI shows and proposes real, applicable changes, so the prototype behaves
// like the finished product. The backend agent (assistant-service, Cursor SDK)
// will expose the same tool names listed in each plan's steps.

import { BIDDING, CAMPAIGN_TYPES, GEO_TARGETS, LIMITS } from "./constants";
import {
  accountBase,
  adGroupBase,
  campaignBase,
  delta,
  derive,
  keywordBase,
  money,
  num,
  pct,
  previousRange,
  searchTermBase,
} from "./metrics";
import { CATALOG_SAMPLE, DEMO_DOMAIN } from "./mock-data";
import { planAdvanced } from "./agent-sim-advanced";
import { emptyBundle, gid, keywordLabel, rateAdStrength } from "./mutations";
import type { ProposedChangeInput } from "./store";
import type { AgentDoc, AgentMemory, BusinessProfile, DocSection } from "./docs";
import { planDocTurn } from "./agent-docs";
import type {
  AccountData,
  AgentMessage,
  Ad,
  AgentToolStep,
  CampaignBundle,
  CampaignType,
  DateRange,
  GaScope,
  GaView,
  LocationTarget,
  MatchType,
  NegativeKeyword,
} from "./types";

export type AgentPlan = {
  steps: AgentToolStep[];
  reply: string;
  changes: Omit<ProposedChangeInput, "messageId">[];
  followUps: string[];
  viewHint?: GaView;
  draftBundle?: CampaignBundle;
  /** Document to open in a new tab. */
  doc?: AgentDoc;
  /** Edit to an existing document (new version). */
  docUpdate?: { docId: string; sections: DocSection[]; note: string; extra?: Partial<AgentDoc> };
  questions?: AgentMessage["questions"];
  team?: { role: string; task: string }[];
  todo?: string[];
  memory?: string;
};

export type Ctx = {
  data: AccountData;
  range: DateRange;
  scope: GaScope;
  profile?: BusinessProfile;
  memories?: AgentMemory[];
  docs?: AgentDoc[];
  /** Document tab the user is looking at, if any. */
  activeDocId?: string;
  /** Merchant Center connection. `false` means not connected; unset means "assume connected". */
  merchantConnected?: boolean;
};

export const STARTER_PROMPTS = [
  "Make me a Ramadan campaign plan",
  "Write my monthly performance report",
  "How did my account perform in the last 30 days?",
  "Where am I wasting budget?",
  "Run a full audit of my account",
  "Fix my Merchant Center product issues",
  "Set up monitoring and alerts for my account",
  "Write better ads for my weakest ad group",
  "Create a Search campaign for running shoes in Saudi Arabia with $60/day",
  "Should I move budget between campaigns?",
];

// ─── Copy library (stands in for catalog-driven generation) ───────────────

export type Theme = "running" | "trail" | "gym" | "brand";

export const HEADLINES: Record<Theme, string[]> = {
  running: [
    "Running Shoes for Every Pace", "Shop Stride Running Shoes", "Light, Cushioned & Fast", "Free Delivery Over $50",
    "Easy 30-Day Returns", "Pay in 4 with Tabby", "Delivered in 1–3 Days", "Glide 3: Nitro Foam Midsole",
    "Pace Lite: Only 198 g", "Breathable Knit Uppers", "Made for Gulf Summers", "Rated 4.8 by Runners",
    "Wide Fits Available", "New Colours Just Landed", "Try Them for 30 Days",
  ],
  trail: [
    "Trail Running Shoes", "Grip for Any Terrain", "Vibram Outsole Grip", "Rock Plate Protection", "Water-Resistant Uppers",
    "Stride Trail X – $149", "Free Delivery Over $50", "Easy 30-Day Returns", "Built for Rocky Trails",
    "Shop Men's & Women's Trail", "Delivered in 1–3 Days", "Pay in 4 with Tabby",
  ],
  gym: [
    "Gym Leggings & Training Tops", "Squat-Proof Gym Leggings", "Quick-Dry Training Tees", "Free Delivery Over $50",
    "Easy 30-Day Returns", "UPF 50 Outdoor Leggings", "Leggings with Phone Pocket", "Anti-Odour Training Tops",
    "Shop Women's Gym Wear", "Shop Men's Training Wear", "Pay in 4 with Tabby", "Delivered in 1–3 Days",
    "Train Cooler in the Heat", "New Colours Every Month", "Rated 4.7 by Customers",
  ],
  brand: [
    "Stride Official Store", "Free Delivery Over $50", "Easy 30-Day Returns", "Shop the New Collection",
    "Pay in 4 with Tabby", "Delivered in 1–3 Days", "Members Get 10% Off", "Built for Gulf Summers",
  ],
};

export const DESCRIPTIONS: Record<Theme, string[]> = {
  running: [
    "Cushioned running shoes for road, track and treadmill. Free delivery over $50.",
    "From the 198 g Pace Lite to the Glide 3 with Nitro foam, find your perfect pace.",
    "Breathable knit uppers that stay cool in the heat. Try any pair for 30 days.",
    "Order today and get it in 1–3 days across KSA & UAE. Pay in 4 with Tabby.",
  ],
  trail: [
    "Trail X with Vibram grip and a rock plate for rough mountain trails.",
    "Water-resistant uppers and secure lacing for wadi runs. Free delivery over $50.",
    "Shop trail running shoes for men and women. Try them for 30 days.",
  ],
  gym: [
    "Squat-proof leggings and quick-dry tops that keep up with every rep.",
    "Laser-cut vents and anti-odour fabrics made for hot gyms. Free delivery over $50.",
    "Shop gym wear for men and women. 30-day returns and split payments with Tabby.",
    "Leggings with phone pockets, UPF 50 and four-way stretch. Order today.",
  ],
  brand: [
    "Shop the official Stride store. Performance shoes and apparel, delivered fast.",
    "Free delivery over $50, 30-day returns and split payments. Find your fit today.",
  ],
};

export function themeOf(text: string): Theme {
  const t = text.toLowerCase();
  if (/trail/.test(t)) return "trail";
  if (/gym|legging|sportswear|activewear|athletic|workout|training|top|clothes/.test(t)) return "gym";
  if (/brand|stride/.test(t) && !/running/.test(t)) return "brand";
  return "running";
}

function fits(max: number) {
  return (s: string) => s.length <= max;
}

function buildRsa(theme: Theme, opts: { lead?: string; finalUrl: string; path1?: string; path2?: string; adGroupId: string }): Ad {
  const headlines = [...new Set([opts.lead, ...HEADLINES[theme]].filter((x): x is string => !!x && fits(LIMITS.headline)(x)))].slice(0, 15);
  const descriptions = DESCRIPTIONS[theme].filter(fits(LIMITS.description)).slice(0, 4);
  return {
    id: gid("ad"),
    adGroupId: opts.adGroupId,
    type: "RESPONSIVE_SEARCH_AD",
    status: "ENABLED",
    headlines: headlines.map((text, i) => (i === 0 && opts.lead ? { text, pinned: "HEADLINE_1" as const } : { text })),
    descriptions: descriptions.map((text) => ({ text })),
    finalUrl: opts.finalUrl,
    path1: opts.path1?.slice(0, LIMITS.path),
    path2: opts.path2?.slice(0, LIMITS.path),
    adStrength: rateAdStrength(headlines, descriptions, [theme]),
    policy: "UNDER_REVIEW",
  };
}

// ─── Small analysis helpers ────────────────────────────────────────────────

const enabled = <T extends { status: string }>(x: T) => x.status === "ENABLED";

function campaignRows(ctx: Ctx) {
  return ctx.data.campaigns
    .filter((c) => c.status !== "REMOVED")
    .map((c) => ({ c, m: derive(campaignBase(ctx.data, c.id, ctx.range)), budget: ctx.data.budgets.find((b) => b.id === c.budgetId) }));
}

function signed(v: number | null): string {
  if (v === null) return "new";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

export function wastedTerms(ctx: Ctx) {
  return ctx.data.searchTerms
    .filter((s) => s.status === "NONE" && s.adGroupId)
    .map((s) => ({ s, m: derive(searchTermBase(ctx.data, s.id, ctx.range)) }))
    .filter(({ m }) => m.cost > 8 && m.conversions < 0.5)
    .sort((a, b) => b.m.cost - a.m.cost);
}

const JUNK_TOKENS = ["free", "jobs", "wholesale", "suppliers", "used", "how to", "ideas", "outlet", "samples"];

function negativeFor(text: string): { text: string; matchType: MatchType } {
  const token = JUNK_TOKENS.find((j) => text.includes(j));
  if (token) return { text: token, matchType: token.includes(" ") ? "PHRASE" : "BROAD" };
  return { text, matchType: "EXACT" };
}

function daysIn(range: DateRange) {
  return Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1;
}

// ─── Scenarios ─────────────────────────────────────────────────────────────

function performance(ctx: Ctx): AgentPlan {
  const { data, range } = ctx;
  const cur = data.account.currency;
  const now = derive(accountBase(data, range));
  const prev = derive(accountBase(data, previousRange(range)));
  const rows = campaignRows(ctx).filter((r) => r.m.cost > 0);
  const best = [...rows].sort((a, b) => b.m.roas - a.m.roas)[0];
  const worst = [...rows].filter((r) => r.m.cost > 50).sort((a, b) => a.m.roas - b.m.roas)[0];
  const limited = rows.filter((r) => r.c.servingIssues.includes("LIMITED_BY_BUDGET"));

  const lines = [
    `Here's the account for **${daysIn(range)} days** (compared with the period before):`,
    "",
    `- **Spend:** ${money(now.cost, cur)} (${signed(delta(now.cost, prev.cost))})`,
    `- **Conversions:** ${num(now.conversions, { decimals: 0 })} (${signed(delta(now.conversions, prev.conversions))})`,
    `- **Conversion value:** ${money(now.conversionsValue, cur)} (${signed(delta(now.conversionsValue, prev.conversionsValue))})`,
    `- **ROAS:** ${now.roas.toFixed(2)}x · **Cost/conv.:** ${money(now.cpa, cur)} · **CTR:** ${pct(now.ctr)}`,
    "",
  ];
  if (best) lines.push(`**Strongest:** ${best.c.name} returns **${best.m.roas.toFixed(2)}x** on ${money(best.m.cost, cur)}.`);
  if (worst && worst !== best)
    lines.push(`**Weakest:** ${worst.c.name} returns only **${worst.m.roas.toFixed(2)}x** at ${money(worst.m.cpa, cur)} per conversion.`);
  if (limited.length)
    lines.push(`\n${limited.map((l) => `**${l.c.name}**`).join(", ")} ${limited.length > 1 ? "are" : "is"} limited by budget while converting well, which is the biggest opportunity right now.`);

  return {
    steps: [
      { tool: "ads_report", label: "Pulled account metrics", detail: `customer · ${range.start} → ${range.end}` },
      { tool: "ads_report", label: "Compared with previous period" },
      { tool: "ads_report", label: `Ranked ${rows.length} campaigns by ROAS` },
    ],
    reply: lines.join("\n"),
    changes: [],
    followUps: ["Where am I wasting budget?", "Should I move budget between campaigns?", "Run a full audit of my account"],
    viewHint: "overview",
  };
}

export function waste(ctx: Ctx): AgentPlan {
  const { data, range } = ctx;
  const cur = data.account.currency;
  const terms = wastedTerms(ctx).slice(0, 8);
  if (!terms.length) {
    return {
      steps: [{ tool: "ads_search_terms", label: "Scanned search terms" }],
      reply: "I didn't find search terms that spend without converting in this period. Your negatives are doing their job.",
      changes: [],
      followUps: ["Find new keyword ideas", "Run a full audit of my account"],
      viewHint: "searchTerms",
    };
  }
  const total = terms.reduce((s, t) => s + t.m.cost, 0);
  const monthly = (total / daysIn(range)) * 30;

  const byCampaign = new Map<string, { text: string; matchType: MatchType; termIds: string[] }[]>();
  for (const { s } of terms) {
    const n = negativeFor(s.text);
    const list = byCampaign.get(s.campaignId) ?? [];
    const existing = list.find((x) => x.text === n.text && x.matchType === n.matchType);
    if (existing) existing.termIds.push(s.id);
    else list.push({ ...n, termIds: [s.id] });
    byCampaign.set(s.campaignId, list);
  }
  const already = new Set(data.negatives.map((n) => `${n.parentId}:${n.text}`));
  const negatives: NegativeKeyword[] = [];
  const termIds: string[] = [];
  for (const [campaignId, list] of byCampaign) {
    for (const n of list) {
      termIds.push(...n.termIds);
      if (already.has(`${campaignId}:${n.text}`)) continue;
      negatives.push({ id: gid("n"), text: n.text, matchType: n.matchType, level: "CAMPAIGN", parentId: campaignId });
    }
  }

  const lines = [
    `I found **${terms.length} search terms** that cost **${money(total, cur)}** in this period with no conversions (about **${money(monthly, cur)}/month**):`,
    "",
    ...terms.map(({ s, m }) => `- "${s.text}": ${money(m.cost, cur)}, ${num(m.clicks)} clicks, 0 conversions`),
    "",
    `I've prepared **${negatives.length} negative keywords** at campaign level. Single words like "free" or "jobs" block every variation; exact negatives block one query without hurting similar good ones.`,
  ];

  return {
    steps: [
      { tool: "ads_search_terms", label: "Scanned search terms report", detail: `${data.searchTerms.length} terms` },
      { tool: "ads_report", label: "Matched cost and conversions per term" },
      { tool: "ads_get_structure", label: "Checked existing negative keywords and lists" },
      { tool: "ads_validate_mutation", label: "Validated negatives (validateOnly)" },
    ],
    reply: lines.join("\n"),
    changes: negatives.length
      ? [
          {
            title: `Add ${negatives.length} negative keywords`,
            rationale: `These queries spent ${money(total, cur)} without a single conversion. Blocking them redirects spend to converting searches.`,
            impact: `≈ ${money(monthly, cur)}/month less wasted spend`,
            risk: "LOW",
            ops: [
              { kind: "negative.create", negatives },
              { kind: "searchTerm.mark", ids: termIds, status: "EXCLUDED" },
            ],
          },
        ]
      : [],
    followUps: ["Pause keywords that don't convert", "Find new keyword ideas", "Should I move budget between campaigns?"],
    viewHint: "searchTerms",
  };
}

export function budget(ctx: Ctx): AgentPlan {
  const { data } = ctx;
  const cur = data.account.currency;
  const rows = campaignRows(ctx).filter((r) => enabled(r.c) && r.budget);
  const accountRoas = derive(accountBase(data, ctx.range)).roas;
  const receivers = rows.filter((r) => r.c.servingIssues.includes("LIMITED_BY_BUDGET") && r.m.roas >= accountRoas);
  const donors = rows.filter((r) => r.m.cost > 0 && r.m.roas < Math.max(1.5, accountRoas * 0.5)).sort((a, b) => a.m.roas - b.m.roas);

  if (!receivers.length) {
    return {
      steps: [{ tool: "ads_report", label: "Compared campaign efficiency and budget limits" }],
      reply: "No campaign is limited by budget while beating the account's ROAS, so I wouldn't move money right now. Revisit after the next 7 days of data.",
      changes: [],
      followUps: ["Where am I wasting budget?", "Run a full audit of my account"],
    };
  }
  const to = receivers[0];
  const from = donors[0];
  const shift = from ? Math.min(Math.round(from.budget!.amount * 0.4), 70) : 0;
  const raise = from ? shift : Math.round(to.budget!.amount * 0.35);

  const changes: AgentPlan["changes"] = [
    {
      title: `Raise ${to.c.name} budget to ${money(to.budget!.amount + raise, cur)}/day`,
      rationale: `It's limited by budget at ${to.m.roas.toFixed(2)}x ROAS, above the account's ${accountRoas.toFixed(2)}x. More budget buys more of the same converting traffic.`,
      impact: `≈ +${num((to.m.conversions / daysIn(ctx.range)) * (raise / to.budget!.amount) * 30, { decimals: 0 })} conversions/month`,
      risk: "MEDIUM",
      ops: [{ kind: "budget.update", budgetId: to.budget!.id, amount: to.budget!.amount + raise }],
    },
  ];
  if (from && shift > 0) {
    changes.push({
      title: `Lower ${from.c.name} budget to ${money(from.budget!.amount - shift, cur)}/day`,
      rationale: `It returns ${from.m.roas.toFixed(2)}x at ${money(from.m.cpa, cur)} per conversion. Moving ${money(shift, cur)}/day keeps total spend flat.`,
      impact: "Total daily spend unchanged",
      risk: "LOW",
      ops: [{ kind: "budget.update", budgetId: from.budget!.id, amount: from.budget!.amount - shift }],
    });
  }

  return {
    steps: [
      { tool: "ads_report", label: "Pulled campaign ROAS and CPA" },
      { tool: "ads_get_structure", label: "Read budgets and serving status" },
      { tool: "ads_report", label: "Checked lost impression share (budget)" },
    ],
    reply: [
      `**${to.c.name}** is the clear winner: ${to.m.roas.toFixed(2)}x ROAS but **limited by budget**, so Google stops showing it part of the day.`,
      from ? `\n**${from.c.name}** is the weakest at ${from.m.roas.toFixed(2)}x. I suggest moving **${money(shift, cur)}/day** from it, so total spend stays the same.` : "",
      "\nBoth changes are waiting for your approval in **Pending changes**.",
    ].join(""),
    changes,
    followUps: ["Where am I wasting budget?", "Pause keywords that don't convert"],
    viewHint: "campaigns",
  };
}

export function pauseKeywords(ctx: Ctx): AgentPlan {
  const { data, range } = ctx;
  const cur = data.account.currency;
  const accountCpa = derive(accountBase(data, range)).cpa || 20;
  const losers = data.keywords
    .filter((k) => k.status === "ENABLED" && data.adGroups.find((g) => g.id === k.adGroupId)?.status === "ENABLED")
    .map((k) => ({ k, m: derive(keywordBase(data, k.id, range)) }))
    .filter(({ m }) => m.cost > accountCpa * 1.5 && (m.conversions < 1 || m.cpa > accountCpa * 3))
    .sort((a, b) => b.m.cost - a.m.cost)
    .slice(0, 6);

  if (!losers.length) {
    return {
      steps: [{ tool: "ads_report", label: "Ranked keywords by cost per conversion" }],
      reply: "Every enabled keyword is converting within a reasonable cost. Nothing to pause.",
      changes: [],
      followUps: ["Where am I wasting budget?"],
      viewHint: "keywords",
    };
  }
  const total = losers.reduce((s, l) => s + l.m.cost, 0);
  return {
    steps: [
      { tool: "ads_report", label: "Pulled keyword performance", detail: `${data.keywords.length} keywords` },
      { tool: "ads_report", label: `Compared against account CPA ${money(accountCpa, cur)}` },
    ],
    reply: [
      `These **${losers.length} keywords** spent **${money(total, cur)}** and convert far worse than your ${money(accountCpa, cur)} account average:`,
      "",
      ...losers.map(({ k, m }) => `- ${keywordLabel(k.text, k.matchType)}: ${money(m.cost, cur)}, ${num(m.conversions, { decimals: 1 })} conv.${k.qualityScore ? `, Quality Score ${k.qualityScore}/10` : ""}`),
      "",
      "Pausing keeps their history, so you can turn them back on any time.",
    ].join("\n"),
    changes: [
      {
        title: `Pause ${losers.length} low-performing keywords`,
        rationale: `They spent ${money(total, cur)} at a cost per conversion over 3× the account average.`,
        impact: `≈ ${money((total / daysIn(range)) * 30, cur)}/month freed up`,
        risk: "LOW",
        ops: [{ kind: "status.set", entity: "KEYWORD", ids: losers.map((l) => l.k.id), status: "PAUSED" }],
      },
    ],
    followUps: ["Should I move budget between campaigns?", "Find new keyword ideas"],
    viewHint: "keywords",
  };
}

function writeAds(ctx: Ctx): AgentPlan {
  const { data, scope } = ctx;
  const searchGroups = data.adGroups.filter(
    (g) => g.type === "SEARCH_STANDARD" && g.status === "ENABLED" && data.campaigns.find((c) => c.id === g.campaignId)?.status === "ENABLED"
  );
  const strengthRank = { PENDING: 0, POOR: 1, AVERAGE: 2, GOOD: 3, EXCELLENT: 4 } as const;
  const scoreOf = (gId: string) =>
    Math.max(0, ...data.ads.filter((a) => a.adGroupId === gId && a.status === "ENABLED" && a.policy !== "DISAPPROVED").map((a) => strengthRank[a.adStrength]));
  const target =
    searchGroups.find((g) => g.id === scope.adGroupId) ?? [...searchGroups].sort((a, b) => scoreOf(a.id) - scoreOf(b.id))[0];
  if (!target) {
    return {
      steps: [{ tool: "ads_get_structure", label: "Looked for Search ad groups" }],
      reply: "There's no active Search ad group to write ads for yet. Want me to create a Search campaign first?",
      changes: [],
      followUps: ["Create a Search campaign for running shoes in Saudi Arabia with $60/day"],
    };
  }
  const theme = themeOf(target.name);
  const keywords = data.keywords.filter((k) => k.adGroupId === target.id && k.status === "ENABLED").map((k) => k.text);
  const lead = theme === "gym" ? "Gym Leggings & Training Tops" : theme === "trail" ? "Trail Running Shoes" : undefined;
  const ad = buildRsa(theme, {
    lead,
    adGroupId: target.id,
    finalUrl: `https://${DEMO_DOMAIN}/collections/${theme === "gym" ? "training" : theme}`,
    path1: theme === "gym" ? "gym-wear" : theme,
    path2: "shop",
  });
  ad.adStrength = rateAdStrength(ad.headlines.map((h) => h.text), ad.descriptions.map((d) => d.text), keywords.length ? keywords : [theme]);
  const weak = data.ads.filter((a) => a.adGroupId === target.id && a.status === "ENABLED" && (a.adStrength === "POOR" || a.policy === "DISAPPROVED"));
  const products = CATALOG_SAMPLE.filter((p) => themeOf(p.category + " " + p.title) === theme).slice(0, 3);

  return {
    steps: [
      { tool: "ads_get_structure", label: `Picked ${target.name}`, detail: "lowest ad strength among active Search ad groups" },
      { tool: "catalog_lookup", label: `Read ${products.length || 3} products from your catalog`, detail: products.map((p) => p.title).join(", ") },
      { tool: "ads_policy_check", label: "Checked copy against ad policies" },
      { tool: "ads_validate_mutation", label: "Validated the new ad (validateOnly)" },
    ],
    reply: [
      `I wrote a new responsive search ad for **${target.name}** from your catalog: **${ad.headlines.length} headlines** and **${ad.descriptions.length} descriptions**, using product facts like ${products.slice(0, 2).map((p) => `"${p.features[0]}"`).join(" and ") || "your best sellers"}.`,
      "",
      `Expected ad strength: **${ad.adStrength.toLowerCase()}**.`,
      weak.length ? `\nI'll also pause the ${weak.length === 1 ? "weak ad" : `${weak.length} weak ads`} it replaces, so budget goes to the stronger copy.` : "",
    ].join("\n"),
    changes: [
      {
        title: `New ad for ${target.name}`,
        rationale: `Current ads here rate ${weak.length ? "Poor or are disapproved" : "below Good"}. More unique, keyword-rich headlines let Google build better combinations.`,
        impact: "Typically +10–15% CTR moving from Poor to Good",
        risk: "LOW",
        ops: [
          { kind: "ad.create", ads: [ad] },
          ...(weak.length ? [{ kind: "status.set" as const, entity: "AD" as const, ids: weak.map((w) => w.id), status: "PAUSED" as const }] : []),
        ],
      },
    ],
    followUps: ["Fix my disapproved ads", "Find new keyword ideas"],
    viewHint: "ads",
  };
}

function disapproved(ctx: Ctx): AgentPlan {
  const { data } = ctx;
  const ads = data.ads.filter((a) => a.policy === "DISAPPROVED" && a.status !== "REMOVED");
  if (!ads.length) {
    return {
      steps: [{ tool: "ads_policy_check", label: "Checked policy status of all ads" }],
      reply: "No ads are disapproved. Everything is approved or still under review.",
      changes: [],
      followUps: ["Write better ads for my weakest ad group"],
      viewHint: "ads",
    };
  }
  const changes: AgentPlan["changes"] = ads.map((ad) => {
    const group = data.adGroups.find((g) => g.id === ad.adGroupId);
    const theme = themeOf(group?.name ?? "");
    const fixed = buildRsa(theme, { adGroupId: ad.adGroupId, finalUrl: ad.finalUrl, path1: ad.path1, path2: ad.path2 });
    return {
      title: `Fix disapproved ad in ${group?.name ?? "ad group"}`,
      rationale: `Rewrites the copy without ${ad.policyTopics?.map((p) => p.topic.toLowerCase()).join(", ") ?? "the flagged claims"}, then resubmits it for review.`,
      impact: "Ad can serve again after review (usually under 1 business day)",
      risk: "LOW",
      ops: [{ kind: "ad.update", adId: ad.id, patch: { headlines: fixed.headlines, descriptions: fixed.descriptions, policy: "UNDER_REVIEW", policyTopics: [], adStrength: fixed.adStrength } }],
    };
  });
  return {
    steps: [
      { tool: "ads_policy_check", label: `Found ${ads.length} disapproved ad${ads.length > 1 ? "s" : ""}` },
      { tool: "ads_policy_check", label: "Read policy topics and evidence" },
      { tool: "catalog_lookup", label: "Pulled verifiable product facts for new copy" },
    ],
    reply: [
      `**${ads.length} ad${ads.length > 1 ? "s are" : " is"} disapproved.** Google flagged:`,
      "",
      ...ads.flatMap((a) => (a.policyTopics ?? []).map((p) => `- **${p.topic}:** ${p.detail}`)),
      "",
      "I rewrote the copy using facts from your catalog instead of claims, removed the competitor trademark and the extra punctuation. Approving will resubmit for review.",
    ].join("\n"),
    changes,
    followUps: ["Write better ads for my weakest ad group", "Run a full audit of my account"],
    viewHint: "ads",
  };
}

function keywordIdeas(ctx: Ctx): AgentPlan {
  const { data, scope, range } = ctx;
  const target =
    data.adGroups.find((g) => g.id === scope.adGroupId && g.type === "SEARCH_STANDARD") ??
    data.adGroups.find((g) => g.id === "ag_run_men") ??
    data.adGroups.find((g) => g.type === "SEARCH_STANDARD" && g.status === "ENABLED");
  if (!target) {
    return {
      steps: [{ tool: "ads_get_structure", label: "Looked for Search ad groups" }],
      reply: "Create a Search campaign first, then I can research keywords for it.",
      changes: [],
      followUps: ["Create a Search campaign for running shoes in Saudi Arabia with $60/day"],
    };
  }
  const existing = new Set(data.keywords.filter((k) => k.adGroupId === target.id).map((k) => k.text));
  const fromTerms = data.searchTerms
    .filter((s) => s.adGroupId === target.id && s.status === "NONE" && s.efficiency >= 1)
    .map((s) => ({ s, m: derive(searchTermBase(data, s.id, range)) }))
    .filter(({ m }) => m.conversions >= 1);
  const theme = themeOf(target.name);
  const fromCatalog = CATALOG_SAMPLE.filter((p) => themeOf(p.category) === theme).flatMap((p) => p.keywords);
  const ideas = [
    ...fromTerms.map(({ s }) => ({ text: s.text, matchType: "EXACT" as MatchType, why: "converting search term", volume: 0 })),
    ...fromCatalog.map((text) => ({ text, matchType: "PHRASE" as MatchType, why: "from your catalog", volume: 0 })),
  ]
    .filter((k, i, all) => !existing.has(k.text) && all.findIndex((x) => x.text === k.text) === i)
    .slice(0, 8)
    .map((k, i) => ({ ...k, volume: [2900, 1600, 1300, 880, 720, 590, 480, 390][i] }));

  return {
    steps: [
      { tool: "ads_search_terms", label: `Read search terms for ${target.name}` },
      { tool: "catalog_lookup", label: "Pulled keywords from your product catalog" },
      { tool: "ads_keyword_planner", label: "Fetched monthly search volume (KSA, UAE)" },
    ],
    reply: [
      `Here are **${ideas.length} keyword ideas** for **${target.name}**:`,
      "",
      ...ideas.map((k) => `- ${keywordLabel(k.text, k.matchType)}: ~${num(k.volume)} searches/mo (${k.why})`),
      "",
      "Converting search terms go in as exact match; catalog ideas as phrase match so Smart Bidding can find close variants.",
    ].join("\n"),
    changes: ideas.length
      ? [
          {
            title: `Add ${ideas.length} keywords to ${target.name}`,
            rationale: "Search terms that already convert, plus product terms from your catalog that aren't covered yet.",
            impact: `≈ ${num(ideas.reduce((s, k) => s + k.volume, 0))} more monthly searches in reach`,
            risk: "LOW",
            ops: [
              {
                kind: "keyword.create",
                keywords: ideas.map((k) => ({ id: gid("k"), adGroupId: target.id, text: k.text, matchType: k.matchType, status: "ENABLED" as const, policy: "UNDER_REVIEW" as const })),
              },
              ...(fromTerms.length ? [{ kind: "searchTerm.mark" as const, ids: fromTerms.map(({ s }) => s.id), status: "ADDED" as const }] : []),
            ],
          },
        ]
      : [],
    followUps: ["Write better ads for my weakest ad group", "Where am I wasting budget?"],
    viewHint: "keywords",
  };
}

function recommendations(ctx: Ctx): AgentPlan {
  const { data } = ctx;
  const active = data.recommendations.filter((r) => r.status === "ACTIVE").sort((a, b) => b.scoreUplift - a.scoreUplift);
  const actionable = active.filter((r) => r.ops.length).slice(0, 2);
  return {
    steps: [{ tool: "ads_recommendations", label: `Read ${active.length} Google Ads recommendations` }],
    reply: [
      `Your optimization score is **${(data.account.optimizationScore * 100).toFixed(1)}%**. Google has **${active.length} recommendations**:`,
      "",
      ...active.map((r) => `- **${r.title}** (+${r.scoreUplift.toFixed(1)} pts): ${r.description}`),
      "",
      actionable.length
        ? `I'd take the top ${actionable.length} that change performance directly. The rest are worth doing but need your input (copy, tracking).`
        : "None of them can be applied automatically; they need your input.",
    ].join("\n"),
    changes: actionable.map((r) => ({
      title: `Google Ads Recommendation: ${r.title}`,
      rationale: r.description,
      impact: r.impact,
      risk: "MEDIUM" as const,
      source: "RECOMMENDATION" as const,
      ops: [...r.ops, { kind: "recommendation.set" as const, ids: [r.id], status: "APPLIED" as const }],
    })),
    followUps: ["Fix my disapproved ads", "Write better ads for my weakest ad group"],
    viewHint: "recommendations",
  };
}

function conversions(ctx: Ctx): AgentPlan {
  const { data } = ctx;
  const issues = data.conversions.filter((c) => c.status === "UNVERIFIED" || c.status === "NO_RECENT_CONVERSIONS");
  const primary = data.conversions.filter((c) => c.primary && c.status !== "REMOVED");
  return {
    steps: [{ tool: "ads_conversions", label: `Checked ${data.conversions.length} conversion actions` }],
    reply: [
      `**Primary goal${primary.length > 1 ? "s" : ""}:** ${primary.map((p) => p.name).join(", ") || "none set"}. Bidding optimises only for primary actions.`,
      "",
      issues.length ? "**Needs attention:**" : "All conversion actions are recording.",
      ...issues.map((c) =>
        c.status === "UNVERIFIED"
          ? `- **${c.name}**: tag not verified yet. Nothing is being recorded.`
          : `- **${c.name}**: no conversions in 7+ days. Check the tag still fires on your site.`
      ),
      "",
      "Tip: enhanced conversions usually recover around 5% of conversions lost to cookie limits.",
    ].join("\n"),
    changes: [],
    followUps: ["Run a full audit of my account", "How did my account perform in the last 30 days?"],
    viewHint: "conversions",
  };
}

export function parseCreate(message: string, data: AccountData): CampaignBundle {
  const m = message.toLowerCase();
  const type: CampaignType = /performance max|pmax/.test(m)
    ? "PERFORMANCE_MAX"
    : /shopping/.test(m)
      ? "SHOPPING"
      : /demand gen/.test(m)
        ? "DEMAND_GEN"
        : /display/.test(m)
          ? "DISPLAY"
          : "SEARCH";
  const amountMatch = m.match(/\$\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(?:\$|usd|dollars?)\b|(\d+)\s?(?:\/\s?day|per day|a day)/);
  const amount = amountMatch ? Number(amountMatch[1] ?? amountMatch[2] ?? amountMatch[3]) : 50;

  const aliases: Record<string, string> = { ksa: "Saudi Arabia", saudi: "Saudi Arabia", uae: "United Arab Emirates", emirates: "United Arab Emirates" };
  const names = new Set<string>();
  for (const g of GEO_TARGETS) if (m.includes(g.name.toLowerCase())) names.add(g.name);
  for (const [alias, name] of Object.entries(aliases)) if (new RegExp(`\\b${alias}\\b`).test(m)) names.add(name);
  if (!names.size) names.add("Saudi Arabia");
  const locations: LocationTarget[] = GEO_TARGETS.filter((g) => names.has(g.name)).map((g) => ({ ...g }));

  const theme = themeOf(m);
  const themeName = theme === "gym" ? "Gym Wear" : theme === "trail" ? "Trail Running" : theme === "brand" ? "Brand" : "Running Shoes";
  const where = locations.length === 1 ? locations[0].name.replace("United Arab Emirates", "UAE") : `${locations.length} countries`;
  let name = `${themeName} – ${CAMPAIGN_TYPES[type].short} – ${where}`;
  if (data.campaigns.some((c) => c.name === name)) name += " (2)";

  const bundle = emptyBundle();
  bundle.campaign = {
    ...bundle.campaign,
    name,
    type,
    objective: "SALES",
    bidding: { type: type === "SEARCH" ? "MAXIMIZE_CONVERSIONS" : "MAXIMIZE_CONVERSION_VALUE" },
    networks:
      type === "SEARCH"
        ? { googleSearch: true, searchPartners: false, displayNetwork: false }
        : { googleSearch: true, searchPartners: true, displayNetwork: true },
    locations,
    conversionActionIds: data.conversions.filter((c) => c.primary).map((c) => c.id),
    merchantFeed: type === "SHOPPING" || (type === "PERFORMANCE_MAX" && !!data.account.merchantCenterId),
  };
  bundle.budget = { name, amount, shared: false, deliveryMethod: "STANDARD" };
  bundle.negativeKeywords = [
    { text: "free", matchType: "BROAD" },
    { text: "jobs", matchType: "BROAD" },
    { text: "used", matchType: "BROAD" },
    { text: "how to", matchType: "PHRASE" },
  ];
  bundle.assets = [
    { type: "CALLOUT", status: "ENABLED", title: "Free Delivery Over $50" },
    { type: "CALLOUT", status: "ENABLED", title: "30-Day Returns" },
  ];

  if (type === "SEARCH") {
    const groups: { name: string; keywords: { text: string; matchType: MatchType }[]; lead: string; path: string }[] =
      theme === "gym"
        ? [
            { name: "Gym Leggings", lead: "Squat-Proof Gym Leggings", path: "leggings", keywords: [{ text: "gym leggings", matchType: "PHRASE" }, { text: "squat proof leggings", matchType: "PHRASE" }, { text: "leggings with pockets", matchType: "PHRASE" }, { text: "gym leggings women", matchType: "EXACT" }] },
            { name: "Training Tops", lead: "Quick-Dry Training Tees", path: "tops", keywords: [{ text: "gym shirts", matchType: "PHRASE" }, { text: "quick dry t-shirt", matchType: "PHRASE" }, { text: "breathable gym shirt", matchType: "EXACT" }] },
          ]
        : theme === "trail"
          ? [{ name: "Trail Running Shoes", lead: "Trail Running Shoes", path: "trail", keywords: [{ text: "trail running shoes", matchType: "PHRASE" }, { text: "waterproof trail shoes", matchType: "PHRASE" }, { text: "trail shoes men", matchType: "EXACT" }, { text: "trail shoes women", matchType: "EXACT" }] }]
          : [
              { name: "Running Shoes – Men", lead: "Men's Running Shoes", path: "men", keywords: [{ text: "men's running shoes", matchType: "PHRASE" }, { text: "running shoes for men", matchType: "EXACT" }, { text: "buy running shoes online", matchType: "PHRASE" }] },
              { name: "Running Shoes – Women", lead: "Women's Running Shoes", path: "women", keywords: [{ text: "women's running shoes", matchType: "PHRASE" }, { text: "running shoes for women", matchType: "EXACT" }, { text: "ladies running shoes", matchType: "PHRASE" }] },
              { name: "Lightweight Running Shoes", lead: "Pace Lite: Only 198 g", path: "lightweight", keywords: [{ text: "lightweight running shoes", matchType: "PHRASE" }, { text: "cushioned running shoes", matchType: "PHRASE" }, { text: "daily trainer shoes", matchType: "BROAD" }] },
            ];
    bundle.adGroups = groups.map((g) => {
      const ad = buildRsa(theme, { lead: g.lead, adGroupId: "", finalUrl: `https://${DEMO_DOMAIN}/collections/${g.path}`, path1: theme === "gym" ? "gym" : "running", path2: g.path });
      return {
        adGroup: { name: g.name, status: "ENABLED" as const, type: "SEARCH_STANDARD" as const },
        keywords: g.keywords.map((k) => ({ ...k, status: "ENABLED" as const })),
        ads: [
          {
            type: ad.type,
            status: ad.status,
            headlines: ad.headlines,
            descriptions: ad.descriptions,
            finalUrl: ad.finalUrl,
            path1: ad.path1,
            path2: ad.path2,
            adStrength: ad.adStrength,
          },
        ],
      };
    });
  } else if (type === "PERFORMANCE_MAX" || type === "DEMAND_GEN" || type === "DISPLAY") {
    bundle.assetGroups =
      type === "PERFORMANCE_MAX"
        ? [
            {
              name: themeName,
              status: "ENABLED",
              finalUrl: `https://${DEMO_DOMAIN}/collections/${theme}`,
              headlines: HEADLINES[theme].slice(0, 8),
              longHeadlines: [DESCRIPTIONS[theme][0].slice(0, LIMITS.longHeadline), DESCRIPTIONS[theme][1].slice(0, LIMITS.longHeadline)],
              descriptions: DESCRIPTIONS[theme].slice(0, 4),
              businessName: "Stride",
              imageUrls: ["landscape-1", "square-1", "portrait-1"],
              logoUrls: ["logo-square"],
              videoUrls: [],
              audienceSignal: "Purchasers (180d) + In-market: Running Shoes",
              searchThemes: CATALOG_SAMPLE.filter((p) => themeOf(p.category) === theme).flatMap((p) => p.keywords).slice(0, 5),
              listingGroups: [theme === "gym" ? "Product type = Apparel" : "Product type = Running"],
              adStrength: "GOOD",
            },
          ]
        : [];
  } else if (type === "SHOPPING") {
    bundle.adGroups = [{ adGroup: { name: "All products", status: "ENABLED", type: "SHOPPING_PRODUCT_ADS" }, keywords: [], ads: [] }];
  }
  return bundle;
}

function createCampaign(message: string, ctx: Ctx): AgentPlan {
  const bundle = parseCreate(message, ctx.data);
  const cur = ctx.data.account.currency;
  const c = bundle.campaign;
  const kwCount = bundle.adGroups.reduce((s, g) => s + g.keywords.length, 0);
  const lines = [
    `I drafted **${c.name}**:`,
    "",
    `- **Type:** ${CAMPAIGN_TYPES[c.type].label} · goal: sales`,
    `- **Budget:** ${money(bundle.budget.amount, cur)}/day (≈ ${money(bundle.budget.amount * 30.4, cur)}/month)`,
    `- **Bidding:** ${BIDDING[c.bidding.type].label}`,
    `- **Locations:** ${c.locations.map((l) => l.name).join(", ")} · **Languages:** ${c.languages.join(", ")}`,
  ];
  if (bundle.adGroups.length && c.type === "SEARCH")
    lines.push(`- **${bundle.adGroups.length} ad groups**, ${kwCount} keywords, ${bundle.adGroups.length} responsive search ads written from your catalog`);
  if (bundle.assetGroups.length) lines.push(`- **Asset group** with ${bundle.assetGroups[0].headlines.length} headlines, images from your gallery and an audience signal`);
  if (c.type === "SHOPPING") lines.push(`- Uses your Merchant Center feed (${ctx.data.account.merchantCenterId ? "linked" : "not linked yet"})`);
  lines.push(`- ${bundle.negativeKeywords.length} starter negatives and ${bundle.assets.length} callouts`);
  lines.push("", "Approve to publish it as is, or open it in the editor to adjust anything first.");

  return {
    steps: [
      { tool: "catalog_lookup", label: "Read matching products from your catalog" },
      { tool: "ads_keyword_planner", label: "Researched keywords and volumes", detail: c.locations.map((l) => l.name).join(", ") },
      { tool: "ads_get_structure", label: "Checked existing campaigns for overlap" },
      { tool: "ads_validate_mutation", label: "Validated the full campaign (validateOnly)" },
    ],
    reply: lines.join("\n"),
    changes: [
      {
        title: `Create campaign: ${c.name}`,
        rationale: `New ${CAMPAIGN_TYPES[c.type].label} campaign at ${money(bundle.budget.amount, cur)}/day, built from your catalog.`,
        impact: `Adds ≈ ${money(bundle.budget.amount * 30.4, cur)}/month of spend`,
        risk: "HIGH",
        ops: [{ kind: "campaign.create", bundle, tempId: gid("c") }],
      },
    ],
    followUps: ["Write better ads for my weakest ad group", "How did my account perform in the last 30 days?"],
    viewHint: "pending",
    draftBundle: bundle,
  };
}

export function audit(ctx: Ctx): AgentPlan {
  const { data, range } = ctx;
  const cur = data.account.currency;
  const wasted = wastedTerms(ctx);
  const wastedTotal = wasted.reduce((s, w) => s + w.m.cost, 0);
  const limited = data.campaigns.filter((c) => c.status === "ENABLED" && c.servingIssues.includes("LIMITED_BY_BUDGET"));
  const poorAds = data.ads.filter((a) => a.status === "ENABLED" && a.adStrength === "POOR");
  const disapprovedAds = data.ads.filter((a) => a.status === "ENABLED" && a.policy === "DISAPPROVED");
  const lowQs = data.keywords.filter((k) => k.status === "ENABLED" && (k.qualityScore ?? 10) <= 4);
  const displayOnSearch = data.campaigns.filter((c) => c.type === "SEARCH" && c.networks.displayNetwork && c.status === "ENABLED");
  const unverified = data.conversions.filter((c) => c.status === "UNVERIFIED");
  const genericAg = data.adGroups.find((g) => g.id === "ag_gen_sportswear");
  const genericBase = genericAg ? derive(adGroupBase(data, genericAg.id, range)) : null;

  const issues: string[] = [];
  if (wasted.length) issues.push(`🔴 **${money(wastedTotal, cur)} on ${wasted.length} search terms with no conversions.** Fix: negative keywords.`);
  if (limited.length) issues.push(`🟠 **${limited.map((c) => c.name).join(", ")} limited by budget** while converting well.`);
  if (disapprovedAds.length) issues.push(`🔴 **${disapprovedAds.length} disapproved ad${disapprovedAds.length > 1 ? "s" : ""}** (unverified claims, trademark).`);
  if (poorAds.length) issues.push(`🟠 **${poorAds.length} ad${poorAds.length > 1 ? "s" : ""} with Poor strength.** Fewer, repetitive headlines.`);
  if (lowQs.length) issues.push(`🟠 **${lowQs.length} keywords with Quality Score ≤ 4**, mostly broad generic terms.`);
  if (displayOnSearch.length) issues.push(`🟡 **${displayOnSearch.map((c) => c.name).join(", ")} also runs on the Display Network**, which usually dilutes Search performance.`);
  if (unverified.length) issues.push(`🟡 **${unverified.map((c) => c.name).join(", ")} isn't verified**, so those conversions aren't counted.`);
  if (genericBase && genericBase.roas < 1.5) issues.push(`🟠 **${genericAg!.name}** returns ${genericBase.roas.toFixed(2)}x, the weakest ad group in the account.`);

  const score = Math.max(38, 100 - issues.length * 8 - Math.round(wastedTotal / 50));

  const plans = [waste(ctx), budget(ctx), pauseKeywords(ctx)];
  const changes = plans.flatMap((p) => p.changes);
  if (displayOnSearch.length) {
    for (const c of displayOnSearch)
      changes.push({
        title: `Turn off Display Network for ${c.name}`,
        rationale: "Search campaigns opted into Display get low-intent clicks at search prices.",
        impact: "Cleaner Search reporting, lower wasted spend",
        risk: "LOW",
        ops: [{ kind: "campaign.update", campaignId: c.id, patch: { networks: { ...c.networks, displayNetwork: false } } }],
      });
  }

  return {
    steps: [
      { tool: "ads_report", label: "Pulled 90-day account performance" },
      { tool: "ads_get_structure", label: `Read ${data.campaigns.length} campaigns, ${data.adGroups.length} ad groups, ${data.keywords.length} keywords` },
      { tool: "ads_search_terms", label: `Scanned ${data.searchTerms.length} search terms` },
      { tool: "ads_policy_check", label: "Checked ad strength and policy status" },
      { tool: "ads_conversions", label: "Checked conversion tracking" },
      { tool: "ads_recommendations", label: "Cross-checked Google's recommendations" },
    ],
    reply: [
      `**Account health: ${score}/100.** I found **${issues.length} issues**, ordered by impact:`,
      "",
      ...issues.map((i) => `- ${i}`),
      "",
      `I've queued **${changes.length} fixes** I can make now. Ads and tracking need a separate step. Ask me to "fix my disapproved ads" or "write better ads".`,
    ].join("\n"),
    changes,
    followUps: ["Fix my disapproved ads", "Write better ads for my weakest ad group", "Check my conversion tracking"],
    viewHint: "pending",
  };
}

function help(ctx: Ctx): AgentPlan {
  const empty = !ctx.data.campaigns.length;
  return {
    steps: [],
    reply: empty
      ? "This account doesn't have any campaigns yet. I can build one from your catalog: tell me the product, the country and a daily budget, for example *“Create a Search campaign for running shoes in Saudi Arabia with $60/day”*."
      : [
          "I can work on anything in this Google Ads account. For example:",
          "",
          "- **Analyse:** performance, trends, what changed and why",
          "- **Cut waste:** search terms, negative keywords, keywords to pause",
          "- **Budgets & bidding:** move budget, set target CPA/ROAS",
          "- **Ads:** write new ads from your catalog, fix disapproved ads",
          "- **Build:** create Search, Performance Max or Shopping campaigns",
          "- **Measure:** check conversion tracking",
          "- **Shopping:** fix Merchant Center issues, exclude products that don't sell",
          "- **Reports:** best hours, devices, ages; forecast budget changes",
          "- **Monitor:** set up rules and alerts that watch the account for you",
          "",
          "Every change waits for your approval unless you turn on auto-approve.",
        ].join("\n"),
    changes: [],
    followUps: empty
      ? ["Create a Search campaign for running shoes in Saudi Arabia with $60/day", "Create a Performance Max campaign for gym wear in UAE with $80/day"]
      : STARTER_PROMPTS.slice(0, 4),
  };
}

export function planAgentTurn(message: string, ctx: Ctx): AgentPlan {
  const m = message.toLowerCase();
  const docTurn = planDocTurn(message, ctx);
  if (docTurn) return docTurn;
  if (/(create|launch|build|set up|start|new).*(campaign|pmax|performance max|shopping)|حملة جديدة|انشئ|أنشئ/.test(m)) return createCampaign(message, ctx);
  if (!ctx.data.campaigns.length) return help(ctx);
  const advanced = planAdvanced(message, ctx);
  if (advanced) return advanced;
  if (/audit|health|review (my|the) account|تدقيق|راجع/.test(m)) return audit(ctx);
  if (/disapprov|rejected|policy|مرفوض/.test(m)) return disapproved(ctx);
  if (/wast|negative|search term|هدر|سلبي/.test(m)) return waste(ctx);
  if (/pause|underperform|low.?perform|don't convert|not converting|اوقف|أوقف/.test(m)) return pauseKeywords(ctx);
  if (/budget|realloc|move (money|spend)|ميزاني/.test(m)) return budget(ctx);
  if (/keyword idea|new keyword|more keyword|expand|كلمات/.test(m)) return keywordIdeas(ctx);
  if (/\bads?\b|copy|headline|rsa|إعلان|اعلان/.test(m)) return writeAds(ctx);
  if (/recommend|optimi[sz]ation score|توصي/.test(m)) return recommendations(ctx);
  if (/conversion|tracking|tag|تتبع|تحويل/.test(m)) return conversions(ctx);
  if (/perform|how.*(doing|did)|summary|report|overview|trend|أداء|ملخص/.test(m)) return performance(ctx);
  return help(ctx);
}

// Segmented reporting, product metrics, forecasts and keyword ideas on the
// demo snapshot. The real versions come from GAQL segments (segments.device,
// segments.hour, …), shopping_performance_view, the Performance Planner
// forecast and KeywordPlanIdeaService.

import { CAMPAIGN_TYPES } from "./constants";
import { EMPTY_BASE, addBase, addDays, campaignBase, dailySeries, derive } from "./metrics";
import type { AccountData, BaseMetrics, Campaign, ContentTarget, DateRange, ListingGroup, Metrics, Product, SegmentKey } from "./types";

export type SegmentRow = { key: string; label: string; base: BaseMetrics; metrics: Metrics };

export const SEGMENTS: Record<SegmentKey, { label: string; hint: string }> = {
  day: { label: "Day", hint: "Daily trend" },
  week: { label: "Week", hint: "Week by week" },
  dayOfWeek: { label: "Day of week", hint: "Which weekdays sell" },
  hour: { label: "Hour of day", hint: "Best hours to show ads" },
  device: { label: "Device", hint: "Mobile, computer or tablet" },
  country: { label: "Location", hint: "Where buyers are" },
  age: { label: "Age", hint: "Age ranges" },
  gender: { label: "Gender", hint: "Female, male, unknown" },
  network: { label: "Network", hint: "Google Search, partners, Display, YouTube" },
  campaignType: { label: "Campaign type", hint: "Search vs Shopping vs PMax…" },
};

/** Split metrics by traffic share, conversions also by efficiency. */
export function splitBase(total: BaseMetrics, parts: { key: string; share: number; efficiency: number }[]): Record<string, BaseMetrics> {
  const s = parts.reduce((a, p) => a + p.share, 0) || 1;
  const e = parts.reduce((a, p) => a + p.share * p.efficiency, 0) || 1;
  const out: Record<string, BaseMetrics> = {};
  for (const p of parts) {
    const t = p.share / s;
    const c = (p.share * p.efficiency) / e;
    out[p.key] = {
      impressions: Math.round(total.impressions * t),
      clicks: Math.round(total.clicks * t),
      cost: total.cost * t,
      conversions: total.conversions * c,
      conversionsValue: total.conversionsValue * c,
    };
  }
  return out;
}

const HOUR_TRAFFIC = [0.6, 0.35, 0.2, 0.15, 0.15, 0.25, 0.6, 1.1, 1.5, 1.6, 1.7, 1.8, 1.9, 1.8, 1.7, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.1, 2.6, 1.4];
const HOUR_EFF = [0.6, 0.5, 0.4, 0.4, 0.4, 0.5, 0.7, 0.8, 0.9, 1, 1, 1, 1.05, 1, 0.95, 1, 1.05, 1.1, 1.2, 1.3, 1.35, 1.3, 1.15, 0.85];
const PROFILES: Partial<Record<SegmentKey, { key: string; share: number; efficiency: number }[]>> = {
  device: [
    { key: "Mobile phones", share: 68, efficiency: 0.85 },
    { key: "Computers", share: 27, efficiency: 1.45 },
    { key: "Tablets", share: 5, efficiency: 0.8 },
  ],
  age: [
    { key: "18–24", share: 16, efficiency: 0.7 },
    { key: "25–34", share: 34, efficiency: 1.25 },
    { key: "35–44", share: 25, efficiency: 1.15 },
    { key: "45–54", share: 12, efficiency: 0.95 },
    { key: "55–64", share: 5, efficiency: 0.6 },
    { key: "65+", share: 2, efficiency: 0.3 },
    { key: "Unknown", share: 6, efficiency: 0.8 },
  ],
  gender: [
    { key: "Female", share: 46, efficiency: 1.15 },
    { key: "Male", share: 47, efficiency: 0.9 },
    { key: "Unknown", share: 7, efficiency: 0.8 },
  ],
};
const COUNTRY_EFF: Record<string, number> = { "Saudi Arabia": 1.05, "United Arab Emirates": 1.15, Kuwait: 0.9, Qatar: 1 };

function totalFor(data: AccountData, range: DateRange, ids: string[]): BaseMetrics {
  return ids.reduce((s, id) => addBase(s, campaignBase(data, id, range)), EMPTY_BASE);
}

export function segmentRows(data: AccountData, range: DateRange, segment: SegmentKey, campaignIds?: string[]): SegmentRow[] {
  const ids = campaignIds ?? data.campaigns.filter((c) => c.status !== "REMOVED").map((c) => c.id);
  const make = (key: string, label: string, base: BaseMetrics): SegmentRow => ({ key, label, base, metrics: derive(base) });
  const total = totalFor(data, range, ids);

  switch (segment) {
    case "day":
      return dailySeries(data, range, ids).map((p) => make(p.date, new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }), p));
    case "week": {
      const weeks = new Map<string, BaseMetrics>();
      for (const p of dailySeries(data, range, ids)) {
        const d = new Date(`${p.date}T00:00:00Z`);
        const start = addDays(p.date, -((d.getUTCDay() + 6) % 7));
        weeks.set(start, addBase(weeks.get(start) ?? EMPTY_BASE, p));
      }
      return [...weeks.entries()].map(([k, b]) => make(k, `Week of ${new Date(`${k}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`, b));
    }
    case "dayOfWeek": {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const days = names.map(() => EMPTY_BASE);
      for (const p of dailySeries(data, range, ids)) {
        const i = new Date(`${p.date}T00:00:00Z`).getUTCDay();
        days[i] = addBase(days[i], p);
      }
      return [1, 2, 3, 4, 5, 6, 0].map((i) => make(String(i), names[i], days[i]));
    }
    case "hour": {
      const parts = HOUR_TRAFFIC.map((share, h) => ({ key: String(h), share, efficiency: HOUR_EFF[h] }));
      const split = splitBase(total, parts);
      return parts.map((p) => make(p.key, `${p.key.padStart(2, "0")}:00`, split[p.key]));
    }
    case "country": {
      const byCountry = new Map<string, BaseMetrics>();
      for (const id of ids) {
        const c = data.campaigns.find((x) => x.id === id);
        const locs = (c?.locations ?? []).filter((l) => !l.excluded && l.kind === "Country");
        const parts = (locs.length ? locs : [{ name: "All locations" }]).map((l, i) => ({ key: l.name, share: i === 0 ? 62 : 38 / Math.max(1, locs.length - 1), efficiency: COUNTRY_EFF[l.name] ?? 1 }));
        const split = splitBase(campaignBase(data, id, range), parts);
        for (const p of parts) byCountry.set(p.key, addBase(byCountry.get(p.key) ?? EMPTY_BASE, split[p.key]));
      }
      return [...byCountry.entries()].map(([k, b]) => make(k, k, b));
    }
    case "network": {
      const rows = new Map<string, BaseMetrics>();
      for (const id of ids) {
        const c = data.campaigns.find((x) => x.id === id);
        if (!c) continue;
        const parts = networkParts(c);
        const split = splitBase(campaignBase(data, id, range), parts);
        for (const p of parts) rows.set(p.key, addBase(rows.get(p.key) ?? EMPTY_BASE, split[p.key]));
      }
      return [...rows.entries()].map(([k, b]) => make(k, k, b));
    }
    case "campaignType": {
      const rows = new Map<string, BaseMetrics>();
      for (const id of ids) {
        const c = data.campaigns.find((x) => x.id === id);
        if (!c) continue;
        const k = CAMPAIGN_TYPES[c.type].label;
        rows.set(k, addBase(rows.get(k) ?? EMPTY_BASE, campaignBase(data, id, range)));
      }
      return [...rows.entries()].map(([k, b]) => make(k, k, b));
    }
    default: {
      const parts = PROFILES[segment] ?? [];
      const split = splitBase(total, parts);
      return parts.map((p) => make(p.key, p.key, split[p.key]));
    }
  }
}

function networkParts(c: Campaign) {
  switch (c.type) {
    case "SEARCH":
      return [
        { key: "Google Search", share: 80, efficiency: 1.1 },
        ...(c.networks.searchPartners ? [{ key: "Search partners", share: 12, efficiency: 0.6 }] : []),
        ...(c.networks.displayNetwork ? [{ key: "Display Network", share: 25, efficiency: 0.15 }] : []),
      ];
    case "PERFORMANCE_MAX":
      return [
        { key: "Google Search", share: 38, efficiency: 1.2 },
        { key: "Shopping (Search)", share: 30, efficiency: 1.3 },
        { key: "YouTube", share: 14, efficiency: 0.5 },
        { key: "Display Network", share: 12, efficiency: 0.4 },
        { key: "Discover & Gmail", share: 6, efficiency: 0.6 },
      ];
    case "SHOPPING":
      return [
        { key: "Shopping (Search)", share: 88, efficiency: 1.05 },
        { key: "Search partners", share: 12, efficiency: 0.6 },
      ];
    case "VIDEO":
      return [{ key: "YouTube", share: 100, efficiency: 1 }];
    case "DEMAND_GEN":
      return [
        { key: "YouTube", share: 55, efficiency: 0.9 },
        { key: "Discover & Gmail", share: 45, efficiency: 1.1 },
      ];
    default:
      return [{ key: "Display Network", share: 100, efficiency: 1 }];
  }
}

// ─── Products ───────────────────────────────────────────────────────────────

/** Product-ad traffic: all of Shopping plus the feed share of PMax. */
function productTraffic(data: AccountData, range: DateRange): BaseMetrics {
  let total = EMPTY_BASE;
  for (const c of data.campaigns) {
    if (c.type === "SHOPPING") total = addBase(total, campaignBase(data, c.id, range));
    if (c.type === "PERFORMANCE_MAX" && c.merchantFeed) {
      const b = campaignBase(data, c.id, range);
      total = addBase(total, { impressions: b.impressions * 0.6, clicks: b.clicks * 0.6, cost: b.cost * 0.6, conversions: b.conversions * 0.6, conversionsValue: b.conversionsValue * 0.6 });
    }
  }
  return total;
}

export function productMetrics(data: AccountData, range: DateRange): Map<string, Metrics> {
  const split = splitBase(productTraffic(data, range), data.products.map((p) => ({ key: p.id, share: p.share, efficiency: p.efficiency })));
  return new Map(data.products.map((p) => [p.id, derive(split[p.id] ?? EMPTY_BASE)]));
}

function matches(p: Product, g: ListingGroup): boolean {
  switch (g.dimension) {
    case "ALL":
      return true;
    case "PRODUCT_TYPE":
      return p.productType.toLowerCase().startsWith(g.value.toLowerCase());
    case "BRAND":
      return p.brand.toLowerCase() === g.value.toLowerCase();
    case "CUSTOM_LABEL_0":
      return (p.customLabel0 ?? "") === g.value;
    case "ITEM_ID":
      return p.id === g.value;
    case "OTHERS":
      return true;
  }
}

/** Products that fall into a node: match it and every ancestor, minus specific siblings for "Others". */
export function productsInGroup(data: AccountData, groupId: string): Product[] {
  const groups = data.listingGroups;
  const chain: ListingGroup[] = [];
  for (let g = groups.find((x) => x.id === groupId); g; g = g.parentId ? groups.find((x) => x.id === g!.parentId) : undefined) chain.unshift(g);
  return data.products.filter((p) =>
    chain.every((g) => {
      if (g.dimension !== "OTHERS") return matches(p, g);
      const siblings = groups.filter((s) => s.parentId === g.parentId && s.id !== g.id && s.dimension !== "OTHERS");
      return !siblings.some((s) => matches(p, s));
    })
  );
}

export function groupMetrics(data: AccountData, groupId: string, metrics: Map<string, Metrics>): Metrics {
  const base = productsInGroup(data, groupId).reduce((s, p) => addBase(s, metrics.get(p.id) ?? EMPTY_BASE), EMPTY_BASE);
  return derive(base);
}

/** What the catalog can fix: the patch Catalog Intelligence would apply. */
export function catalogFix(p: Product): Product {
  const fixable = p.issues.filter((i) => i.fixable);
  if (!fixable.length) return p;
  let next: Product = { ...p, issues: p.issues.filter((i) => !i.fixable) };
  for (const issue of fixable) {
    if (issue.code === "missing_gtin") next = { ...next, gtin: `62${p.id.replace(/\D/g, "").padStart(11, "1")}` };
    if (issue.code === "title_too_long") next = { ...next, title: p.title.split(" ").slice(0, 7).join(" ") };
    if (issue.code === "price_mismatch") next = { ...next, price: p.benchmarkPrice ?? p.price };
  }
  return { ...next, status: next.issues.some((i) => i.severity === "DISAPPROVED") ? "DISAPPROVED" : "PENDING" };
}

// ─── Placements ─────────────────────────────────────────────────────────────

export function contentMetrics(data: AccountData, range: DateRange, targets: ContentTarget[]): Map<string, Metrics> {
  const out = new Map<string, Metrics>();
  const byCampaign = new Map<string, ContentTarget[]>();
  for (const t of targets) byCampaign.set(t.campaignId, [...(byCampaign.get(t.campaignId) ?? []), t]);
  for (const [cid, list] of byCampaign) {
    const live = list.filter((t) => !t.excluded);
    const split = splitBase(campaignBase(data, cid, range), live.map((t) => ({ key: t.id, share: t.share, efficiency: t.efficiency })));
    for (const t of list) out.set(t.id, derive(split[t.id] ?? EMPTY_BASE));
  }
  return out;
}

// ─── Forecast (Performance Planner) ────────────────────────────────────────

export type ForecastPoint = { budget: number; cost: number; conversions: number; value: number; clicks: number };

/**
 * Diminishing-returns curve around the campaign's last 30 days. Campaigns
 * limited by budget respond more strongly to extra spend.
 */
export function forecastCampaign(data: AccountData, campaign: Campaign, range: DateRange, dailyBudget: number): ForecastPoint {
  const base = campaignBase(data, campaign.id, range);
  const days = Math.max(1, Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1);
  const currentBudget = data.budgets.find((b) => b.id === campaign.budgetId)?.amount ?? 1;
  const dailyCost = base.cost / days || currentBudget * 0.8;
  const limited = campaign.servingIssues.includes("LIMITED_BY_BUDGET");
  const ceiling = limited ? currentBudget * 2.2 : currentBudget * 1.3;
  const spend = Math.min(dailyBudget * 0.97, ceiling);
  const ratio = spend / Math.max(1, dailyCost);
  const elasticity = limited ? 0.82 : 0.45;
  const scale = Math.pow(ratio, elasticity);
  return {
    budget: dailyBudget,
    cost: spend * 30.4,
    conversions: (base.conversions / days) * scale * 30.4,
    value: (base.conversionsValue / days) * scale * 30.4,
    clicks: (base.clicks / days) * Math.pow(ratio, 0.75) * 30.4,
  };
}

// ─── Keyword Planner ───────────────────────────────────────────────────────

export type KeywordIdea = { text: string; volume: number; trend: number[]; competition: "LOW" | "MEDIUM" | "HIGH"; bidLow: number; bidHigh: number };

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const MODIFIERS = ["", "buy ", "best ", "cheap ", "online", "for men", "for women", "near me", "sale", "lightweight ", "waterproof ", "price", "riyadh", "dubai", "review"];

export function keywordIdeas(seed: string, opts: { location: string; language: string }): KeywordIdea[] {
  const base = seed.trim().toLowerCase();
  if (!base) return [];
  const ideas = new Set<string>([base]);
  for (const m of MODIFIERS) {
    if (!m) continue;
    ideas.add(m.endsWith(" ") ? `${m}${base}` : `${base} ${m}`);
  }
  const words = base.split(/\s+/);
  if (words.length > 1) ideas.add(words.slice(-1)[0]);
  return [...ideas].map((text) => {
    const h = hash(`${text}|${opts.location}|${opts.language}`);
    const volume = text === base ? 6600 : [10, 30, 50, 90, 140, 210, 320, 480, 720, 880, 1300, 1900, 2400][h % 13];
    const competition = (["LOW", "MEDIUM", "HIGH"] as const)[(h >>> 4) % 3];
    const bidLow = 0.15 + ((h >>> 8) % 60) / 100;
    const trend = Array.from({ length: 12 }, (_, i) => Math.round(volume * (0.7 + (((h >>> (i % 16)) % 60) / 100) + (i >= 4 && i <= 7 ? 0.25 : 0))));
    return { text, volume, trend, competition, bidLow, bidHigh: bidLow * (2.2 + ((h >>> 12) % 10) / 10) };
  }).sort((a, b) => b.volume - a.volume);
}

import { DATE_PRESETS } from "./constants";
import type { AccountData, BaseMetrics, DailyPoint, DateRange, DateRangePreset, MetricKey, Metrics } from "./types";

export const EMPTY_BASE: BaseMetrics = { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 };

export function addBase(a: BaseMetrics, b: BaseMetrics): BaseMetrics {
  return {
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    cost: a.cost + b.cost,
    conversions: a.conversions + b.conversions,
    conversionsValue: a.conversionsValue + b.conversionsValue,
  };
}

export function derive(base: BaseMetrics): Metrics {
  return {
    ...base,
    ctr: base.impressions ? base.clicks / base.impressions : 0,
    avgCpc: base.clicks ? base.cost / base.clicks : 0,
    convRate: base.clicks ? base.conversions / base.clicks : 0,
    cpa: base.conversions ? base.cost / base.conversions : 0,
    roas: base.cost ? base.conversionsValue / base.cost : 0,
  };
}

// ─── Dates ──────────────────────────────────────────────────────────────────

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

/** Reports end yesterday: today's data is incomplete in Google Ads. */
export function rangeFor(preset: DateRangePreset, today = isoDay(new Date())): DateRange {
  const end = addDays(today, -1);
  const start = addDays(end, -(DATE_PRESETS[preset].days - 1));
  return { preset, start, end };
}

export function previousRange(range: DateRange): DateRange {
  const days = DATE_PRESETS[range.preset].days;
  return { preset: range.preset, start: addDays(range.start, -days), end: addDays(range.start, -1) };
}

export function formatRange(range: DateRange): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(range.start)} – ${fmt(range.end)}`;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

function sumDaily(points: DailyPoint[] | undefined, range: DateRange): BaseMetrics {
  if (!points) return EMPTY_BASE;
  let total = EMPTY_BASE;
  for (const p of points) if (p.date >= range.start && p.date <= range.end) total = addBase(total, p);
  return total;
}

export function campaignBase(data: AccountData, campaignId: string, range: DateRange): BaseMetrics {
  return sumDaily(data.daily[campaignId], range);
}

/**
 * Split a parent's metrics across children by traffic share; conversions also
 * follow each child's efficiency so totals still add up to the parent.
 */
function split(parent: BaseMetrics, children: { id: string; share: number; efficiency: number }[], id: string): BaseMetrics {
  const totalShare = children.reduce((s, c) => s + c.share, 0) || 1;
  const totalConvWeight = children.reduce((s, c) => s + c.share * c.efficiency, 0) || 1;
  const me = children.find((c) => c.id === id);
  if (!me) return EMPTY_BASE;
  const trafficRatio = me.share / totalShare;
  const convRatio = (me.share * me.efficiency) / totalConvWeight;
  return {
    impressions: Math.round(parent.impressions * trafficRatio),
    clicks: Math.round(parent.clicks * trafficRatio),
    cost: parent.cost * trafficRatio,
    conversions: parent.conversions * convRatio,
    conversionsValue: parent.conversionsValue * convRatio,
  };
}

function weightOf(data: AccountData, id: string) {
  return { id, ...(data.weights[id] ?? { share: 1, efficiency: 1 }) };
}

export function adGroupBase(data: AccountData, adGroupId: string, range: DateRange): BaseMetrics {
  const adGroup = data.adGroups.find((g) => g.id === adGroupId);
  if (!adGroup) return EMPTY_BASE;
  const siblings = data.adGroups.filter((g) => g.campaignId === adGroup.campaignId && g.status !== "REMOVED");
  return split(campaignBase(data, adGroup.campaignId, range), siblings.map((g) => weightOf(data, g.id)), adGroupId);
}

export function assetGroupBase(data: AccountData, assetGroupId: string, range: DateRange): BaseMetrics {
  const group = data.assetGroups.find((g) => g.id === assetGroupId);
  if (!group) return EMPTY_BASE;
  const siblings = data.assetGroups.filter((g) => g.campaignId === group.campaignId && g.status !== "REMOVED");
  return split(campaignBase(data, group.campaignId, range), siblings.map((g) => weightOf(data, g.id)), assetGroupId);
}

export function keywordBase(data: AccountData, keywordId: string, range: DateRange): BaseMetrics {
  const kw = data.keywords.find((k) => k.id === keywordId);
  if (!kw || kw.status === "PAUSED" || kw.status === "REMOVED") return EMPTY_BASE;
  const siblings = data.keywords.filter((k) => k.adGroupId === kw.adGroupId && k.status === "ENABLED");
  return split(adGroupBase(data, kw.adGroupId, range), siblings.map((k) => weightOf(data, k.id)), keywordId);
}

export function adBase(data: AccountData, adId: string, range: DateRange): BaseMetrics {
  const ad = data.ads.find((a) => a.id === adId);
  if (!ad || ad.status !== "ENABLED" || ad.policy === "DISAPPROVED") return EMPTY_BASE;
  const siblings = data.ads.filter((a) => a.adGroupId === ad.adGroupId && a.status === "ENABLED" && a.policy !== "DISAPPROVED");
  return split(adGroupBase(data, ad.adGroupId, range), siblings.map((a) => weightOf(data, a.id)), adId);
}

export function searchTermBase(data: AccountData, termId: string, range: DateRange): BaseMetrics {
  const term = data.searchTerms.find((t) => t.id === termId);
  if (!term) return EMPTY_BASE;
  const siblings = data.searchTerms.filter((t) => t.adGroupId === term.adGroupId || (!t.adGroupId && t.campaignId === term.campaignId));
  const parent = term.adGroupId
    ? adGroupBase(data, term.adGroupId, range)
    : campaignBase(data, term.campaignId, range);
  // Search terms only cover part of the traffic Google reports on.
  const visible = { ...parent, impressions: parent.impressions * 0.82, clicks: parent.clicks * 0.82, cost: parent.cost * 0.82, conversions: parent.conversions * 0.82, conversionsValue: parent.conversionsValue * 0.82 };
  return split(visible, siblings.map((t) => ({ id: t.id, share: t.share, efficiency: t.efficiency })), termId);
}

export function accountBase(data: AccountData, range: DateRange, campaignIds?: string[]): BaseMetrics {
  const ids = campaignIds ?? data.campaigns.map((c) => c.id);
  return ids.reduce((sum, id) => addBase(sum, campaignBase(data, id, range)), EMPTY_BASE);
}

/** Daily totals across the given campaigns, for charts. */
export function dailySeries(data: AccountData, range: DateRange, campaignIds?: string[]): (Metrics & { date: string })[] {
  const ids = campaignIds ?? data.campaigns.map((c) => c.id);
  const byDate = new Map<string, BaseMetrics>();
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) byDate.set(d, EMPTY_BASE);
  for (const id of ids) {
    for (const p of data.daily[id] ?? []) {
      const cur = byDate.get(p.date);
      if (cur) byDate.set(p.date, addBase(cur, p));
    }
  }
  return [...byDate.entries()].map(([date, base]) => ({ date, ...derive(base) }));
}

/** Relative change, or null when there is nothing to compare against. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return (current - previous) / previous;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function money(value: number, currency = "USD", opts: { compact?: boolean; decimals?: number } = {}): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: opts.compact && Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: opts.decimals ?? (Math.abs(value) >= 1000 ? 0 : 2),
    minimumFractionDigits: opts.decimals ?? 0,
  }).format(value);
}

export function num(value: number, opts: { compact?: boolean; decimals?: number } = {}): string {
  return new Intl.NumberFormat("en-US", {
    notation: opts.compact && Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: opts.decimals ?? (Math.abs(value) < 100 && value % 1 !== 0 ? 2 : 0),
  }).format(value);
}

export function pct(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export const METRICS: Record<
  MetricKey,
  { label: string; short: string; format: (v: number, currency: string) => string; higherIsBetter: boolean; color: string }
> = {
  impressions: { label: "Impressions", short: "Impr.", format: (v) => num(v, { compact: true }), higherIsBetter: true, color: "#0d9488" },
  clicks: { label: "Clicks", short: "Clicks", format: (v) => num(v, { compact: true }), higherIsBetter: true, color: "#2563eb" },
  cost: { label: "Cost", short: "Cost", format: (v, c) => money(v, c, { compact: true }), higherIsBetter: false, color: "#dc2626" },
  conversions: { label: "Conversions", short: "Conv.", format: (v) => num(v, { decimals: 1 }), higherIsBetter: true, color: "#400095" },
  conversionsValue: { label: "Conv. value", short: "Conv. value", format: (v, c) => money(v, c, { compact: true }), higherIsBetter: true, color: "#F76D01" },
  ctr: { label: "CTR", short: "CTR", format: (v) => pct(v), higherIsBetter: true, color: "#7c3aed" },
  avgCpc: { label: "Avg. CPC", short: "Avg. CPC", format: (v, c) => money(v, c, { decimals: 2 }), higherIsBetter: false, color: "#0891b2" },
  convRate: { label: "Conv. rate", short: "Conv. rate", format: (v) => pct(v), higherIsBetter: true, color: "#16a34a" },
  cpa: { label: "Cost / conv.", short: "Cost/conv.", format: (v, c) => money(v, c, { decimals: 2 }), higherIsBetter: false, color: "#ea580c" },
  roas: { label: "Conv. value / cost", short: "ROAS", format: (v) => `${v.toFixed(2)}x`, higherIsBetter: true, color: "#c026d3" },
};

export function formatMetric(key: MetricKey, value: number, currency: string): string {
  return METRICS[key].format(value, currency);
}

export function formatCustomerId(id: string): string {
  return id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

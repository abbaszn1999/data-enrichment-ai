// Applies MutateOps to an account snapshot. Pure: returns the next snapshot
// plus the ops that undo it. The server will run the same ops through the
// Google Ads API mutate endpoints (validateOnly first, then for real).

import { LIMITS, MATCH_TYPES } from "./constants";
import { money } from "./metrics";
import type {
  AccountData,
  Ad,
  AdStrength,
  AdText,
  CampaignBundle,
  CollectionKey,
  DiffRow,
  EntityStatus,
  Keyword,
  MatchType,
  MutateOp,
} from "./types";

export function gid(prefix: string): string {
  const rand = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

type StatusEntity = Extract<MutateOp, { kind: "status.set" }>["entity"];

const STATUS_COLLECTION: Record<StatusEntity, "campaigns" | "adGroups" | "ads" | "keywords" | "assets" | "assetGroups"> = {
  CAMPAIGN: "campaigns",
  AD_GROUP: "adGroups",
  AD: "ads",
  KEYWORD: "keywords",
  ASSET: "assets",
  ASSET_GROUP: "assetGroups",
};

function pick<T extends object>(source: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) out[k] = source[k];
  return out;
}

function applyOne(data: AccountData, op: MutateOp): { next: AccountData; inverse: MutateOp[] } {
  switch (op.kind) {
    case "campaign.create": {
      const { bundle } = op;
      const campaignId = op.tempId;
      const budgetId = gid("b");
      const today = new Date().toISOString();
      const adGroups = bundle.adGroups.map((g) => ({ ...g, id: gid("ag") }));
      const weights = { ...data.weights };
      const next: AccountData = {
        ...data,
        budgets: [...data.budgets, { ...bundle.budget, id: budgetId }],
        campaigns: [
          ...data.campaigns,
          { ...bundle.campaign, id: campaignId, budgetId, createdAt: today, servingIssues: ["PENDING"], labels: ["Created by agent"] },
        ],
        adGroups: [...data.adGroups, ...adGroups.map((g) => ({ ...g.adGroup, id: g.id, campaignId }))],
        keywords: [
          ...data.keywords,
          ...adGroups.flatMap((g) => g.keywords.map((k) => ({ ...k, id: gid("k"), adGroupId: g.id, policy: "UNDER_REVIEW" as const }))),
        ],
        ads: [
          ...data.ads,
          ...adGroups.flatMap((g) => g.ads.map((a) => ({ ...a, id: gid("ad"), adGroupId: g.id, policy: "UNDER_REVIEW" as const }))),
        ],
        assetGroups: [...data.assetGroups, ...bundle.assetGroups.map((g) => ({ ...g, id: gid("asg"), campaignId }))],
        negatives: [
          ...data.negatives,
          ...bundle.negativeKeywords.map((n) => ({ ...n, id: gid("n"), level: "CAMPAIGN" as const, parentId: campaignId })),
        ],
        assets: [
          ...data.assets,
          ...bundle.assets.map((a) => ({ ...a, id: gid("as"), level: "CAMPAIGN" as const, parentId: campaignId, policy: "UNDER_REVIEW" as const })),
        ],
        daily: { ...data.daily, [campaignId]: [] },
        weights,
      };
      for (const g of adGroups) weights[g.id] = { share: 1, efficiency: 1 };
      return { next, inverse: [{ kind: "status.set", entity: "CAMPAIGN", ids: [campaignId], status: "REMOVED" }] };
    }

    case "campaign.update": {
      const current = data.campaigns.find((c) => c.id === op.campaignId);
      if (!current) throw new Error(`Campaign ${op.campaignId} not found`);
      const before = pick(current, Object.keys(op.patch) as (keyof typeof current)[]);
      return {
        next: { ...data, campaigns: data.campaigns.map((c) => (c.id === op.campaignId ? { ...c, ...op.patch } : c)) },
        inverse: [{ kind: "campaign.update", campaignId: op.campaignId, patch: before }],
      };
    }

    case "campaign.remove":
      return applyOne(data, { kind: "status.set", entity: "CAMPAIGN", ids: [op.campaignId], status: "REMOVED" });

    case "budget.update": {
      const current = data.budgets.find((b) => b.id === op.budgetId);
      if (!current) throw new Error(`Budget ${op.budgetId} not found`);
      // A budget raised well above spend lifts the "Limited by budget" flag.
      const campaigns = data.campaigns.map((c) =>
        c.budgetId === op.budgetId && op.amount >= current.amount * 1.3
          ? { ...c, servingIssues: c.servingIssues.filter((s) => s !== "LIMITED_BY_BUDGET") }
          : c
      );
      return {
        next: { ...data, campaigns, budgets: data.budgets.map((b) => (b.id === op.budgetId ? { ...b, amount: op.amount } : b)) },
        inverse: [{ kind: "budget.update", budgetId: op.budgetId, amount: current.amount }],
      };
    }

    case "status.set": {
      const key = STATUS_COLLECTION[op.entity];
      const list = data[key] as { id: string; status: EntityStatus }[];
      const previous = new Map<EntityStatus, string[]>();
      for (const item of list) {
        if (!op.ids.includes(item.id)) continue;
        previous.set(item.status, [...(previous.get(item.status) ?? []), item.id]);
      }
      return {
        next: { ...data, [key]: list.map((item) => (op.ids.includes(item.id) ? { ...item, status: op.status } : item)) },
        inverse: [...previous.entries()].map(([status, ids]) => ({ kind: "status.set" as const, entity: op.entity, ids, status })),
      };
    }

    case "adGroup.create":
      return {
        next: {
          ...data,
          adGroups: [...data.adGroups, op.adGroup],
          keywords: [...data.keywords, ...op.keywords],
          ads: [...data.ads, ...op.ads],
          weights: { ...data.weights, [op.adGroup.id]: { share: 0.2, efficiency: 1 } },
        },
        inverse: [{ kind: "status.set", entity: "AD_GROUP", ids: [op.adGroup.id], status: "REMOVED" }],
      };

    case "adGroup.update": {
      const current = data.adGroups.find((g) => g.id === op.adGroupId);
      if (!current) throw new Error(`Ad group ${op.adGroupId} not found`);
      return {
        next: { ...data, adGroups: data.adGroups.map((g) => (g.id === op.adGroupId ? { ...g, ...op.patch } : g)) },
        inverse: [{ kind: "adGroup.update", adGroupId: op.adGroupId, patch: pick(current, Object.keys(op.patch) as (keyof typeof current)[]) }],
      };
    }

    case "keyword.create": {
      const weights = { ...data.weights };
      for (const k of op.keywords) weights[k.id] = { share: 0.12, efficiency: 1 };
      return {
        next: { ...data, keywords: [...data.keywords, ...op.keywords], weights },
        inverse: [{ kind: "status.set", entity: "KEYWORD", ids: op.keywords.map((k) => k.id), status: "REMOVED" }],
      };
    }

    case "keyword.update": {
      const current = data.keywords.find((k) => k.id === op.keywordId);
      if (!current) throw new Error(`Keyword ${op.keywordId} not found`);
      return {
        next: { ...data, keywords: data.keywords.map((k) => (k.id === op.keywordId ? { ...k, ...op.patch } : k)) },
        inverse: [{ kind: "keyword.update", keywordId: op.keywordId, patch: pick(current, Object.keys(op.patch) as (keyof Keyword)[]) }],
      };
    }

    case "negative.create":
      return {
        next: { ...data, negatives: [...data.negatives, ...op.negatives] },
        inverse: [{ kind: "negative.remove", ids: op.negatives.map((n) => n.id) }],
      };

    case "negative.remove": {
      const removed = data.negatives.filter((n) => op.ids.includes(n.id));
      return {
        next: { ...data, negatives: data.negatives.filter((n) => !op.ids.includes(n.id)) },
        inverse: [{ kind: "negative.create", negatives: removed }],
      };
    }

    case "ad.create": {
      const weights = { ...data.weights };
      for (const a of op.ads) weights[a.id] = { share: 1, efficiency: 1 };
      return {
        next: { ...data, ads: [...data.ads, ...op.ads], weights },
        inverse: [{ kind: "status.set", entity: "AD", ids: op.ads.map((a) => a.id), status: "REMOVED" }],
      };
    }

    case "ad.update": {
      const current = data.ads.find((a) => a.id === op.adId);
      if (!current) throw new Error(`Ad ${op.adId} not found`);
      return {
        next: { ...data, ads: data.ads.map((a) => (a.id === op.adId ? { ...a, ...op.patch } : a)) },
        inverse: [{ kind: "ad.update", adId: op.adId, patch: pick(current, Object.keys(op.patch) as (keyof Ad)[]) }],
      };
    }

    case "asset.create":
      return {
        next: { ...data, assets: [...data.assets, ...op.assets] },
        inverse: [{ kind: "status.set", entity: "ASSET", ids: op.assets.map((a) => a.id), status: "REMOVED" }],
      };

    case "audience.attach":
      return {
        next: { ...data, audienceTargets: [...data.audienceTargets, ...op.targets] },
        inverse: [{ kind: "audience.detach", ids: op.targets.map((t) => t.id) }],
      };

    case "audience.detach": {
      const removed = data.audienceTargets.filter((t) => op.ids.includes(t.id));
      return {
        next: { ...data, audienceTargets: data.audienceTargets.filter((t) => !op.ids.includes(t.id)) },
        inverse: [{ kind: "audience.attach", targets: removed }],
      };
    }

    case "conversion.create":
      return {
        next: { ...data, conversions: [...data.conversions, op.action] },
        inverse: [{ kind: "conversion.update", actionId: op.action.id, patch: { status: "REMOVED" } }],
      };

    case "conversion.update": {
      const current = data.conversions.find((c) => c.id === op.actionId);
      if (!current) throw new Error(`Conversion action ${op.actionId} not found`);
      return {
        next: { ...data, conversions: data.conversions.map((c) => (c.id === op.actionId ? { ...c, ...op.patch } : c)) },
        inverse: [{ kind: "conversion.update", actionId: op.actionId, patch: pick(current, Object.keys(op.patch) as (keyof typeof current)[]) }],
      };
    }

    case "searchTerm.mark": {
      const previous = data.searchTerms.filter((s) => op.ids.includes(s.id));
      return {
        next: { ...data, searchTerms: data.searchTerms.map((s) => (op.ids.includes(s.id) ? { ...s, status: op.status } : s)) },
        inverse: previous.map((s) => ({ kind: "searchTerm.mark" as const, ids: [s.id], status: s.status })),
      };
    }

    case "recommendation.set": {
      const previous = data.recommendations.filter((r) => op.ids.includes(r.id));
      // Applying or dismissing a recommendation takes it out of the score, as in Google Ads.
      const points = previous.reduce((s, r) => {
        const wasOpen = r.status === "ACTIVE";
        const nowOpen = op.status === "ACTIVE";
        return s + (wasOpen && !nowOpen ? r.scoreUplift : !wasOpen && nowOpen ? -r.scoreUplift : 0);
      }, 0);
      const score = Math.min(1, Math.max(0, data.account.optimizationScore + points / 100));
      return {
        next: {
          ...data,
          account: { ...data.account, optimizationScore: score },
          recommendations: data.recommendations.map((r) => (op.ids.includes(r.id) ? { ...r, status: op.status } : r)),
        },
        inverse: previous.map((r) => ({ kind: "recommendation.set" as const, ids: [r.id], status: r.status })),
      };
    }

    case "account.update": {
      const before = pick(data.account, Object.keys(op.patch) as (keyof typeof data.account)[]);
      return {
        next: { ...data, account: { ...data.account, ...op.patch } },
        inverse: [{ kind: "account.update", patch: before as Extract<MutateOp, { kind: "account.update" }>["patch"] }],
      };
    }

    case "assetGroup.update": {
      const current = data.assetGroups.find((g) => g.id === op.assetGroupId);
      if (!current) throw new Error(`Asset group ${op.assetGroupId} not found`);
      return {
        next: { ...data, assetGroups: data.assetGroups.map((g) => (g.id === op.assetGroupId ? { ...g, ...op.patch } : g)) },
        inverse: [{ kind: "assetGroup.update", assetGroupId: op.assetGroupId, patch: pick(current, Object.keys(op.patch) as (keyof typeof current)[]) }],
      };
    }

    case "collection.upsert": {
      const list = data[op.collection] as { id: string }[];
      const items = op.items as { id: string }[];
      const byId = new Map(items.map((i) => [i.id, i]));
      const previous = list.filter((x) => byId.has(x.id));
      const added = items.filter((i) => !list.some((x) => x.id === i.id)).map((i) => i.id);
      const nextList = [...list.map((x) => byId.get(x.id) ?? x), ...items.filter((i) => added.includes(i.id))];
      const inverse: MutateOp[] = [];
      if (added.length) inverse.push({ kind: "collection.remove", collection: op.collection, ids: added });
      if (previous.length) inverse.push({ kind: "collection.upsert", collection: op.collection, items: previous } as MutateOp);
      return { next: { ...data, [op.collection]: nextList }, inverse };
    }

    case "collection.remove": {
      const list = data[op.collection] as { id: string }[];
      const removed = list.filter((x) => op.ids.includes(x.id));
      return {
        next: { ...data, [op.collection]: list.filter((x) => !op.ids.includes(x.id)) },
        inverse: removed.length ? [{ kind: "collection.upsert", collection: op.collection, items: removed } as MutateOp] : [],
      };
    }
  }
}

const COLLECTION_LABEL: Record<CollectionKey, string> = {
  products: "Product",
  listingGroups: "Product group",
  rules: "Automated rule",
  alerts: "Alert",
  scheduledReports: "Scheduled report",
  experiments: "Experiment",
  contentTargets: "Placement / topic",
  demographics: "Demographic",
  links: "Linked account",
  valueRules: "Value rule",
  offlineImports: "Offline import",
  audiences: "Audience segment",
};

function itemName(item: Record<string, unknown>): string {
  const v = item.name ?? item.title ?? item.value ?? item.fileName ?? item.id;
  return String(v);
}

/** Apply ops in order; inverse ops are returned in undo order. */
export function applyOps(data: AccountData, ops: MutateOp[]): { next: AccountData; inverse: MutateOp[] } {
  let next = data;
  const inverse: MutateOp[] = [];
  for (const op of ops) {
    const result = applyOne(next, op);
    next = result.next;
    inverse.unshift(...result.inverse);
  }
  return { next, inverse };
}

// ─── Human-readable diffs ──────────────────────────────────────────────────

const STATUS_LABEL: Record<EntityStatus, string> = { ENABLED: "Enabled", PAUSED: "Paused", REMOVED: "Removed" };

export function keywordLabel(text: string, matchType: MatchType): string {
  return MATCH_TYPES[matchType].syntax(text);
}

export function describeOps(data: AccountData, ops: MutateOp[]): DiffRow[] {
  const cur = data.account.currency;
  const campaignName = (id: string) => data.campaigns.find((c) => c.id === id)?.name ?? id;
  const adGroupName = (id: string) => data.adGroups.find((g) => g.id === id)?.name ?? id;
  const rows: DiffRow[] = [];

  for (const op of ops) {
    switch (op.kind) {
      case "campaign.create":
        rows.push({ label: "New campaign", after: `${op.bundle.campaign.name} · ${money(op.bundle.budget.amount, cur)}/day` });
        for (const g of op.bundle.adGroups)
          rows.push({ label: `Ad group`, after: `${g.adGroup.name} · ${g.keywords.length} keywords · ${g.ads.length} ads` });
        for (const g of op.bundle.assetGroups) rows.push({ label: "Asset group", after: g.name });
        break;
      case "campaign.update": {
        const c = data.campaigns.find((x) => x.id === op.campaignId);
        for (const [key, value] of Object.entries(op.patch)) {
          const before = c ? (c as Record<string, unknown>)[key] : undefined;
          rows.push({ label: `${campaignName(op.campaignId)} · ${key}`, before: summarize(before), after: summarize(value) });
        }
        break;
      }
      case "campaign.remove":
        rows.push({ label: campaignName(op.campaignId), before: "Enabled", after: "Removed" });
        break;
      case "budget.update": {
        const b = data.budgets.find((x) => x.id === op.budgetId);
        rows.push({ label: `Daily budget · ${b?.name ?? op.budgetId}`, before: b ? money(b.amount, cur) : undefined, after: money(op.amount, cur) });
        break;
      }
      case "status.set": {
        const key = STATUS_COLLECTION[op.entity];
        const list = data[key] as { id: string; status: EntityStatus; name?: string; text?: string; title?: string; matchType?: MatchType; headlines?: AdText[] }[];
        for (const id of op.ids) {
          const item = list.find((x) => x.id === id);
          const name = item
            ? item.name ?? (item.text && item.matchType ? keywordLabel(item.text, item.matchType) : item.title ?? item.headlines?.[0]?.text ?? id)
            : id;
          rows.push({ label: name, before: item ? STATUS_LABEL[item.status] : undefined, after: STATUS_LABEL[op.status] });
        }
        break;
      }
      case "adGroup.create":
        rows.push({ label: `New ad group in ${campaignName(op.adGroup.campaignId)}`, after: `${op.adGroup.name} · ${op.keywords.length} keywords · ${op.ads.length} ads` });
        break;
      case "adGroup.update":
        for (const [key, value] of Object.entries(op.patch))
          rows.push({ label: `${adGroupName(op.adGroupId)} · ${key}`, after: summarize(value) });
        break;
      case "keyword.create":
        for (const k of op.keywords) rows.push({ label: `Keyword · ${adGroupName(k.adGroupId)}`, after: keywordLabel(k.text, k.matchType) });
        break;
      case "keyword.update": {
        const k = data.keywords.find((x) => x.id === op.keywordId);
        if (op.patch.matchType && k)
          rows.push({ label: `Match type · ${k.text}`, before: MATCH_TYPES[k.matchType].label, after: MATCH_TYPES[op.patch.matchType].label });
        if (op.patch.cpcBid !== undefined && k)
          rows.push({ label: `Max CPC · ${keywordLabel(k.text, k.matchType)}`, before: k.cpcBid ? money(k.cpcBid, cur) : "Ad group default", after: money(op.patch.cpcBid, cur) });
        break;
      }
      case "negative.create":
        for (const n of op.negatives) {
          const where = n.level === "CAMPAIGN" ? campaignName(n.parentId) : n.level === "AD_GROUP" ? adGroupName(n.parentId) : data.negativeLists.find((l) => l.id === n.parentId)?.name ?? "List";
          rows.push({ label: `Negative keyword · ${where}`, after: keywordLabel(n.text, n.matchType) });
        }
        break;
      case "negative.remove":
        for (const id of op.ids) {
          const n = data.negatives.find((x) => x.id === id);
          rows.push({ label: "Negative keyword", before: n ? keywordLabel(n.text, n.matchType) : id, after: "Removed" });
        }
        break;
      case "ad.create":
        for (const a of op.ads)
          rows.push({ label: `New ad · ${adGroupName(a.adGroupId)}`, after: `${a.headlines.length} headlines, ${a.descriptions.length} descriptions` });
        break;
      case "ad.update":
        rows.push({ label: "Ad", after: Object.keys(op.patch).join(", ") + " updated" });
        break;
      case "asset.create":
        for (const a of op.assets) rows.push({ label: `New ${a.type.toLowerCase().replace("_", " ")}`, after: a.title });
        break;
      case "audience.attach":
        for (const t of op.targets) {
          const seg = data.audiences.find((s) => s.id === t.segmentId);
          rows.push({ label: `Audience · ${t.level === "CAMPAIGN" ? campaignName(t.parentId) : adGroupName(t.parentId)}`, after: `${seg?.name ?? t.segmentId} (${t.mode.toLowerCase()})` });
        }
        break;
      case "audience.detach":
        rows.push({ label: "Audience segments", after: `${op.ids.length} removed` });
        break;
      case "conversion.create":
        rows.push({ label: "New conversion action", after: op.action.name });
        break;
      case "conversion.update":
        rows.push({ label: data.conversions.find((c) => c.id === op.actionId)?.name ?? "Conversion action", after: Object.entries(op.patch).map(([k, v]) => `${k}: ${summarize(v)}`).join(", ") });
        break;
      case "searchTerm.mark":
        break;
      case "recommendation.set":
        break;
      case "account.update":
        for (const [key, value] of Object.entries(op.patch))
          rows.push({ label: `Account · ${key}`, before: summarize((data.account as Record<string, unknown>)[key]), after: summarize(value) });
        break;
      case "assetGroup.update": {
        const g = data.assetGroups.find((x) => x.id === op.assetGroupId);
        for (const key of Object.keys(op.patch)) rows.push({ label: `${g?.name ?? "Asset group"} · ${key}`, after: "updated" });
        break;
      }
      case "collection.upsert": {
        const list = data[op.collection] as { id: string }[];
        for (const item of op.items as unknown as Record<string, unknown>[]) {
          const exists = list.some((x) => x.id === item.id);
          rows.push({ label: `${exists ? "Update" : "New"} ${COLLECTION_LABEL[op.collection].toLowerCase()}`, after: itemName(item) });
        }
        break;
      }
      case "collection.remove": {
        const list = data[op.collection] as unknown as Record<string, unknown>[];
        for (const id of op.ids) {
          const item = list.find((x) => x.id === id);
          rows.push({ label: COLLECTION_LABEL[op.collection], before: item ? itemName(item) : id, after: "Removed" });
        }
        break;
      }
    }
  }
  return rows;
}

function summarize(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === "object" ? (v as { name?: string }).name ?? "item" : String(v))).join(", ") : "None";
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("type" in v) {
      const extra = v.targetCpa ? ` · $${v.targetCpa}` : v.targetRoas ? ` · ${Math.round(Number(v.targetRoas) * 100)}%` : "";
      return `${String(v.type).toLowerCase().replace(/_/g, " ")}${extra}`;
    }
    return Object.entries(v).map(([k, x]) => `${k}: ${summarize(x)}`).join(", ");
  }
  return String(value);
}

// ─── Helpers shared by editors and the agent ──────────────────────────────

/** Parse one keyword per line: `[exact]`, `"phrase"`, anything else broad. */
export function parseKeywordLines(input: string, fallback: MatchType = "BROAD"): { text: string; matchType: MatchType }[] {
  const seen = new Set<string>();
  const out: { text: string; matchType: MatchType }[] = [];
  for (const raw of input.split(/[\n,]/)) {
    const line = raw.trim();
    if (!line) continue;
    let matchType: MatchType = fallback;
    let text = line;
    if (/^\[.*\]$/.test(line)) {
      matchType = "EXACT";
      text = line.slice(1, -1);
    } else if (/^".*"$/.test(line)) {
      matchType = "PHRASE";
      text = line.slice(1, -1);
    }
    text = text.trim().toLowerCase().slice(0, LIMITS.keywordText);
    const key = `${matchType}:${text}`;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, matchType });
  }
  return out;
}

/** Rough ad strength, following what Google rewards: count, uniqueness, keywords. */
export function rateAdStrength(headlines: string[], descriptions: string[], keywords: string[] = []): AdStrength {
  const h = headlines.map((x) => x.trim()).filter(Boolean);
  const d = descriptions.map((x) => x.trim()).filter(Boolean);
  if (h.length < LIMITS.rsaHeadlinesMin || d.length < LIMITS.rsaDescriptionsMin) return "PENDING";
  const unique = new Set(h.map((x) => x.toLowerCase())).size;
  const kwHits = keywords.length
    ? h.filter((x) => keywords.some((k) => x.toLowerCase().includes(k.toLowerCase().split(" ")[0]))).length
    : Math.min(2, h.length);
  let score = 0;
  score += Math.min(unique, 15) / 15 * 4;
  score += Math.min(d.length, 4) / 4 * 2;
  score += Math.min(kwHits, 3) / 3 * 2;
  if (h.some((x) => x.length > LIMITS.headline) || d.some((x) => x.length > LIMITS.description)) score -= 2;
  if (score >= 6.8) return "EXCELLENT";
  if (score >= 5.2) return "GOOD";
  if (score >= 3.6) return "AVERAGE";
  return "POOR";
}

export function emptyBundle(): CampaignBundle {
  return {
    campaign: {
      name: "",
      status: "ENABLED",
      type: "SEARCH",
      objective: "SALES",
      bidding: { type: "MAXIMIZE_CONVERSIONS" },
      networks: { googleSearch: true, searchPartners: false, displayNetwork: false },
      locations: [],
      languages: ["Arabic", "English"],
      schedule: [],
      devices: { mobile: 0, desktop: 0, tablet: 0 },
      startDate: new Date().toISOString().slice(0, 10),
      conversionActionIds: [],
      euPoliticalAds: false,
      aiMax: false,
    },
    budget: { name: "", amount: 50, shared: false, deliveryMethod: "STANDARD" },
    adGroups: [],
    assetGroups: [],
    negativeKeywords: [],
    assets: [],
  };
}

import { formatUsd, type MockSeedRow, type SeedProbe } from "./mock-data";
import {
  COLLECTION_PUSH_USD,
  EXTRACT_CAP_PER_SEED,
  collectionPushCostUsd,
} from "@/lib/market-research/cost";

/** Full-page workspace after Stage 3 Extract. Agent is gone. */
export type WorkspaceTab = "extract" | "collections" | "content" | "strategy";
export type FlowTab = "niches" | "catalog" | "seeds" | WorkspaceTab;

export const FLOW_TABS: {
  id: FlowTab;
  n: number;
  label: string;
}[] = [
  { id: "niches", n: 1, label: "Niches" },
  { id: "catalog", n: 2, label: "Catalog" },
  { id: "seeds", n: 3, label: "Seed terms" },
  { id: "extract", n: 4, label: "Extract" },
  { id: "collections", n: 5, label: "Collections" },
  { id: "content", n: 6, label: "On-page" },
  { id: "strategy", n: 7, label: "Content strategy" },
];

export const WORKSPACE_TABS = FLOW_TABS.filter(
  (tab): tab is { id: WorkspaceTab; n: number; label: string } =>
    tab.n >= 4
);

export const TAB_ORDER: WorkspaceTab[] = WORKSPACE_TABS.map((t) => t.id);

export function isWorkspaceTab(tab: FlowTab): tab is WorkspaceTab {
  return (
    tab === "extract" ||
    tab === "collections" ||
    tab === "content" ||
    tab === "strategy"
  );
}

export function briefStageFromFlow(tab: FlowTab): 1 | 2 | 3 | null {
  if (tab === "niches") return 1;
  if (tab === "catalog") return 2;
  if (tab === "seeds") return 3;
  return null;
}

export { EXTRACT_CAP_PER_SEED };
export const USD_PER_COLLECTION = COLLECTION_PUSH_USD;
export const EXTRACT_MS = 8_000;
export const ANALYZE_MS = 2_200;
export const CLUSTER_MS = 2_800;
export const CONTENT_MS = 4_200;
export const STRATEGY_MS = 2_600;

export type KeywordSheet = "category" | "informational" | "excluded";

export type ExtractedKeyword = {
  id: string;
  seedId: string;
  seed: string;
  keyword: string;
  volume: number;
  difficulty: number;
  wordCount: number;
  isQuestion: boolean;
  sheet: KeywordSheet;
  productMatches: number;
  /** How many raw keywords this row stands in for (for the “of N” counter). */
  weight: number;
  exclusionReason?: string;
  plpConcept?: string;
};

export type SeedExtractProgress = {
  seedId: string;
  seed: string;
  cap: number;
  pulled: number;
};

export type MarketResearchProductAttribute = {
  name: string;
  value: string;
};

export type MarketResearchProductPrice = {
  amount: number;
  currency: string;
  compareAtPrice?: number;
  priceFormatted: string;
};

export type MarketResearchProduct = {
  id: string;
  title: string;
  handle: string;
  url: string;
  primaryImage?: string;
  images: string[];
  price: MarketResearchProductPrice;
  shortDescription?: string;
  fullDescription?: string;
  vendor?: string;
  productType?: string;
  tags: string[];
  attributes: MarketResearchProductAttribute[];
  collectionIds: string[];
  collectionNames: string[];
  inStock: boolean;
  totalInventory?: number;
};

export type CollectionProductMatch = {
  productId: string;
  score: number;
  rationale?: string;
};

export type ProposedCollection = {
  id: string;
  name: string;
  headKeyword: string;
  parentNiche: string;
  volume: number;
  difficulty: number;
  productCount: number;
  keywordCount: number;
  status: "new" | "existing" | "merge";
  existingName?: string;
  matchedProductIds?: string[];
  productMatches?: CollectionProductMatch[];
  candidateMatches?: CollectionProductMatch[];
  /** Real handle/slug assigned by the store after push. Source of truth for widget matching. */
  storeHandle?: string;
  storeCollectionId?: string;
};

export type CollectionFaq = { q: string; a: string };
export type CollectionLink = { label: string; href: string };

export type CollectionContent = {
  collectionId: string;
  seoTitle: string;
  seoDescription: string;
  collectionDescription: string;
  faqs: CollectionFaq[];
  links: CollectionLink[];
  /**
   * When this copy last reached the live store. Kept on the content itself so
   * the status survives a refresh, and so regenerating the copy resets it —
   * new copy that never left the dashboard is not synced.
   */
  seoSyncedAt?: number;
  seoSyncError?: string;
};

export type OnPageInstructionField =
  | "seoTitle"
  | "seoDescription"
  | "collectionDescription"
  | "faq";

export type OnPageInstructions = Record<OnPageInstructionField, string>;

export const EMPTY_ON_PAGE_INSTRUCTIONS: OnPageInstructions = {
  seoTitle: "",
  seoDescription: "",
  collectionDescription: "",
  faq: "",
};

export function normalizeOnPageInstructions(
  value: unknown
): OnPageInstructions {
  if (typeof value === "string") {
    const t = value.trim();
    return {
      seoTitle: t,
      seoDescription: t,
      collectionDescription: t,
      faq: t,
    };
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return {
      seoTitle: String(v.seoTitle ?? ""),
      seoDescription: String(v.seoDescription ?? ""),
      collectionDescription: String(v.collectionDescription ?? ""),
      faq: String(v.faq ?? ""),
    };
  }
  return { ...EMPTY_ON_PAGE_INSTRUCTIONS };
}

export type StrategyArticleType = "guide" | "comparison" | "faq" | "roundup";
export type StrategyPriority = "high" | "medium" | "low";

/** A collection page the article must link to, with the anchor text to use. */
export type ArticleLinkTarget = {
  anchor: string;
  url: string;
  collectionName: string;
};

export type ArticleStatus =
  | "pending"
  | "generating"
  | "ready"
  | "syncing"
  | "scheduled"
  | "failed";

export type StrategyArticle = {
  id: string;
  title: string;
  /** The informational keyword the title was built from, verbatim. */
  keyword: string;
  type: StrategyArticleType;
  /** Store blog the writer picked. "-" until the article is generated. */
  category: string;
  /** Copied verbatim from the source keyword. */
  volume: number;
  /** Copied verbatim from the source keyword. */
  difficulty: number;
  linksOut: ArticleLinkTarget[];
  priority: StrategyPriority;
  /**
   * Near-duplicate keywords folded into this article. One article covering the
   * whole intent beats several competing for the same query.
   */
  mergedCount?: number;
  status: ArticleStatus;
  error?: string;
};

export type GeneratedArticle = {
  articleId: string;
  seoTitle: string;
  seoDescription: string;
  /** Blog title chosen from the store, or "none" when nothing fits. */
  blogTitle: string;
  bodyHtml: string;
  images: Array<{ url: string; alt: string }>;
  /** Cover image uploaded to the store's article listing. */
  featuredImage?: { url: string; alt: string };
  storeArticleId?: string;
  storeHandle?: string;
  scheduledAt?: string;
};

export type StoreBlog = {
  id: string;
  handle: string;
  title: string;
};

/** Hard ceiling on how many informational keywords Stage 7 will plan for. */
export const MAX_STRATEGY_KEYWORDS = 240;
/** Articles generated in parallel, one request each. */
export const ARTICLE_GENERATION_CONCURRENCY = 3;
/**
 * Articles per sync request. The endpoint accepts 50 and creates them one at a
 * time against Shopify, so half that leaves room under the function timeout.
 */
export const ARTICLE_SYNC_BATCH_SIZE = 25;

export type KeywordFilters = {
  minVolume: number;
  maxKd: number;
  questionsOnly: boolean;
  query: string;
};

export const DEFAULT_FILTERS: KeywordFilters = {
  minVolume: 0,
  maxKd: 100,
  questionsOnly: false,
  query: "",
};

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) % 100000;
  }
  return h;
}

const INFO_PATTERNS = [
  "how to choose {s}",
  "what is {s}",
  "{s} vs glasses",
  "best {s} guide",
  "how to clean {s}",
  "{s} buying guide",
  "are {s} worth it",
  "why buy {s}",
  "{s} for beginners",
  "difference between {s}",
];

const CATEGORY_PATTERNS = [
  "{s}",
  "buy {s}",
  "{s} online",
  "cheap {s}",
  "best {s}",
  "men's {s}",
  "women's {s}",
  "kids {s}",
  "{s} sale",
  "designer {s}",
  "polarized {s}",
  "aviator {s}",
  "{s} shop",
  "wholesale {s}",
];

function fill(pattern: string, seed: string): string {
  return pattern.replace("{s}", seed.toLowerCase());
}

/**
 * Display sample for the extracted set. The UI reports the real pulled cap
 * (min of probe raw and 10k) while the table stays browser-friendly.
 */
export function buildExtractedKeywords(
  seeds: MockSeedRow[],
  probes: Record<string, SeedProbe>
): ExtractedKeyword[] {
  const rows: ExtractedKeyword[] = [];
  for (const seed of seeds) {
    const probe = probes[seed.id];
    const pulled = Math.min(
      EXTRACT_CAP_PER_SEED,
      probe && !probe.failed ? probe.rawKeywords : 400
    );
    const seedTerm = seed.broadSeedVariation;
    const products = seed.productCount;

    CATEGORY_PATTERNS.forEach((pattern, i) => {
      const keyword = fill(pattern, seedTerm);
      const h = hash(keyword);
      rows.push({
        id: `${seed.id}-c-${i}`,
        seedId: seed.id,
        seed: seedTerm,
        keyword,
        volume: 40 + (h % 9800),
        difficulty: 8 + (h % 72),
        wordCount: keyword.split(/\s+/).length,
        isQuestion: false,
        sheet: "category",
        productMatches: Math.max(
          4,
          Math.round(products * (0.04 + (h % 40) / 100))
        ),
        weight: Math.max(1, Math.round(pulled / 28)),
      });
    });

    INFO_PATTERNS.forEach((pattern, i) => {
      const keyword = fill(pattern, seedTerm);
      const h = hash(keyword + "i");
      rows.push({
        id: `${seed.id}-i-${i}`,
        seedId: seed.id,
        seed: seedTerm,
        keyword,
        volume: 20 + (h % 4200),
        difficulty: 5 + (h % 55),
        wordCount: keyword.split(/\s+/).length,
        isQuestion: /^(how|what|why|are)\b/.test(keyword),
        sheet: "informational",
        productMatches: Math.max(0, Math.round(products * 0.01)),
        weight: Math.max(1, Math.round(pulled / 40)),
      });
    });
  }
  return rows;
}

export function pulledCountForSeed(
  seed: MockSeedRow,
  probes: Record<string, SeedProbe>
): number {
  const probe = probes[seed.id];
  if (!probe || probe.failed) return 400;
  return Math.min(EXTRACT_CAP_PER_SEED, probe.rawKeywords);
}

export function filterKeywords(
  rows: ExtractedKeyword[],
  filters: KeywordFilters,
  sheet?: KeywordSheet
): ExtractedKeyword[] {
  const q = filters.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (sheet && row.sheet !== sheet) return false;
    if (row.volume < filters.minVolume) return false;
    if (row.difficulty > filters.maxKd) return false;
    if (filters.questionsOnly && !row.isQuestion) return false;
    if (!q) return true;
    return (
      row.keyword.toLowerCase().includes(q) ||
      row.seed.toLowerCase().includes(q)
    );
  });
}

export function weightedCount(rows: ExtractedKeyword[]): number {
  return rows.reduce((sum, row) => sum + row.weight, 0);
}

export function buildProposedCollections(
  seeds: MockSeedRow[],
  keywords: ExtractedKeyword[]
): ProposedCollection[] {
  const byCanonical = new Map<string, MockSeedRow[]>();
  for (const seed of seeds) {
    const key = seed.canonicalNicheSeed;
    byCanonical.set(key, [...(byCanonical.get(key) ?? []), seed]);
  }

  const list: ProposedCollection[] = [];
  for (const [canonical, family] of byCanonical) {
    const head = family.find((s) => s.scopeMatch === "Exact") ?? family[0];
    const related = keywords.filter(
      (k) =>
        k.sheet === "category" &&
        family.some((s) => s.id === k.seedId)
    );
    const volume = related.reduce((sum, k) => sum + k.volume, 0);
    const difficulty = related.length
      ? Math.round(
          related.reduce((sum, k) => sum + k.difficulty, 0) / related.length
        )
      : 28;
    const existing = head.scopeMatch === "Exact";
    list.push({
      id: `col-${head.collectionId}`,
      name: canonical,
      headKeyword: head.broadSeedVariation.toLowerCase(),
      parentNiche: head.broadParentNiche,
      volume,
      difficulty,
      productCount: head.productCount,
      keywordCount: related.length,
      status: "new",
    });
  }

  // A couple of gap collections the matching step would surface.
  if (seeds.some((s) => /sun/i.test(s.broadSeedVariation))) {
    list.push({
      id: "col-polarized-sunglasses",
      name: "Polarized Sunglasses",
      headKeyword: "polarized sunglasses",
      parentNiche: "Eyewear",
      volume: 18400,
      difficulty: 34,
      productCount: 860,
      keywordCount: 42,
      status: "new",
    });
  }
  if (seeds.some((s) => /toy|game/i.test(s.broadSeedVariation))) {
    list.push({
      id: "col-educational-toys",
      name: "Educational Toys",
      headKeyword: "educational toys",
      parentNiche: "Toys",
      volume: 22100,
      difficulty: 29,
      productCount: 410,
      keywordCount: 38,
      status: "new",
    });
  }
  return list;
}

export function buildCollectionContent(
  collection: ProposedCollection,
  instructions?: OnPageInstructions | string
): CollectionContent {
  const fields = normalizeOnPageInstructions(instructions);
  const clip = (value: string) =>
    value.trim() ? ` Written to follow: “${value.trim().slice(0, 80)}”.` : "";
  const name = collection.name;
  return {
    collectionId: collection.id,
    seoTitle: `${name} | Shop ${collection.headKeyword}`,
    seoDescription: `Browse ${collection.productCount.toLocaleString("en-US")} ${name.toLowerCase()}. Compare styles, find the right fit, and buy with fast shipping.${clip(fields.seoDescription)}`,
    collectionDescription: `${name} for every budget and style. This collection groups products your catalog already carries for “${collection.headKeyword}” — ${collection.productCount.toLocaleString("en-US")} matching items, covering ${collection.keywordCount} related search terms.${clip(fields.collectionDescription)}`,
    faqs: [
      {
        q: `What should I look for when buying ${name.toLowerCase()}?`,
        a: `Start with fit and use. ${name} in this collection are grouped so you can filter by the attributes shoppers actually search for, then compare a shortlist.${clip(fields.faq)}`,
      },
      {
        q: `Do you sell ${collection.headKeyword} for kids and adults?`,
        a: `Where the catalog supports it, both are included. Product count on this page is the live match against your store — not a marketing estimate.`,
      },
      {
        q: `How do I care for ${name.toLowerCase()}?`,
        a: `Follow the care notes on each product. Category FAQs stay high-level so they remain accurate across the whole collection.`,
      },
    ],
    links: [
      {
        label: collection.existingName ?? collection.parentNiche,
        href: `/collections/${collection.id.replace(/^col-/, "")}`,
      },
      { label: "Buying guide", href: "/pages/guide" },
      { label: "Related collections", href: "/collections" },
    ],
  };
}

export function titleFromKeyword(keyword: string): string {
  const titled = keyword
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .replace(/\bVs\b/, "vs");
  if (/^(Are|What|Why)\b/.test(titled) && !titled.endsWith("?")) {
    return `${titled}?`;
  }
  return titled;
}

export function typeFromKeyword(keyword: string): StrategyArticleType {
  const k = keyword.toLowerCase();
  if (/\bvs\b|difference between/.test(k)) return "comparison";
  if (/\bworth it\b|^(are|what is|why)\b/.test(k)) return "faq";
  if (/buying guide|best .+ guide/.test(k)) return "roundup";
  return "guide";
}

export function priorityFor(volume: number, difficulty: number): StrategyPriority {
  const score = volume / Math.max(12, difficulty);
  if (score > 80) return "high";
  if (score > 28) return "medium";
  return "low";
}

/**
 * The informational keywords, deduplicated on normalized text and ordered by
 * volume. Uncapped: the cap is applied later, after the seeds have been given
 * their share.
 */
export function uniqueInformationalKeywords(
  keywords: ExtractedKeyword[]
): ExtractedKeyword[] {
  const seen = new Set<string>();
  const unique: ExtractedKeyword[] = [];

  for (const row of keywords) {
    if (row.sheet !== "informational") continue;
    const key = row.keyword.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  unique.sort((a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword));
  return unique;
}

/**
 * Picks the informational keywords Stage 7 will plan articles for.
 *
 * Taking the top N by volume alone lets the busiest seed swallow the entire
 * plan — a large store ends up with a hundred articles about chargers and none
 * about a whole department. So the quota is dealt round-robin across seeds:
 * every seed gets its first pick before any seed gets a second, and volume
 * decides the order within a seed. Seeds that run dry simply drop out.
 */
export function selectStrategyKeywords(
  keywords: ExtractedKeyword[],
  limit = MAX_STRATEGY_KEYWORDS
): ExtractedKeyword[] {
  const unique = uniqueInformationalKeywords(keywords);
  const cap = Math.max(0, limit);
  if (unique.length <= cap) return unique;

  const bySeed = new Map<string, ExtractedKeyword[]>();
  for (const row of unique) {
    const key = row.seedId || row.seed || "unknown";
    const bucket = bySeed.get(key);
    if (bucket) bucket.push(row);
    else bySeed.set(key, [row]);
  }

  // Richest seeds first so the rounds stay full for as long as possible.
  const buckets = [...bySeed.values()].sort((a, b) => b.length - a.length);
  const picked: ExtractedKeyword[] = [];

  for (let round = 0; picked.length < cap; round += 1) {
    let placed = false;
    for (const bucket of buckets) {
      if (round >= bucket.length) continue;
      picked.push(bucket[round]);
      placed = true;
      if (picked.length >= cap) break;
    }
    if (!placed) break;
  }

  return picked.sort(
    (a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword)
  );
}

export function collectionCharge(count: number): number {
  return collectionPushCostUsd(count);
}

export function formatCollectionCharge(count: number): string {
  return formatUsd(collectionCharge(count));
}

export function tabIndex(tab: WorkspaceTab): number {
  return TAB_ORDER.indexOf(tab);
}

export function clampWorkspaceTab(
  value: unknown,
  fallback: WorkspaceTab = "extract"
): WorkspaceTab {
  if (value === "analyze") return "extract";
  return TAB_ORDER.includes(value as WorkspaceTab)
    ? (value as WorkspaceTab)
    : fallback;
}

export function maxTab(
  a: WorkspaceTab,
  b: WorkspaceTab
): WorkspaceTab {
  return tabIndex(a) >= tabIndex(b) ? a : b;
}

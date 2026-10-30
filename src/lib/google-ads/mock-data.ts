// Demo data for the Google Ads prototype: one manager account with a mature
// store account and an empty one. Deterministic, so screens look the same on
// every load. Replaced by the server adapter once the API is connected.

import { addDays, isoDay } from "./metrics";
import { ASSET_RATINGS, buildDemoExtras, emptyExtras } from "./mock-extras";
import type {
  AccountData,
  Ad,
  AdGroup,
  AdText,
  Asset,
  AssetGroup,
  AudienceSegment,
  AudienceTarget,
  Campaign,
  CampaignBudget,
  ConversionAction,
  DailyPoint,
  GoogleAccount,
  MerchantAccount,
  Keyword,
  MatchType,
  NegativeKeyword,
  Recommendation,
  SearchTerm,
} from "./types";

export const DEMO_GOOGLE_EMAIL = "marketing@stride-demo.com";
export const DEMO_DOMAIN = "stride-demo.com";

/** Merchant Center accounts the demo Google user can reach. The first one is linked to the main demo ad account. */
export const MERCHANT_ACCOUNTS: MerchantAccount[] = [
  { merchantId: "512889034", name: "Stride Store Feed", website: "stride-demo.com", country: "SA" },
  { merchantId: "512889077", name: "Stride Egypt Store", website: "eg.stride-demo.com", country: "EG" },
];

export const MANAGER_ACCOUNT: GoogleAccount = {
  customerId: "4410097721",
  name: "Stride Group (Manager)",
  currency: "USD",
  timeZone: "Asia/Riyadh",
  isManager: true,
  optimizationScore: 0,
  autoTagging: true,
};

// ─── Deterministic random ───────────────────────────────────────────────────

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SeriesProfile = {
  seed: number;
  impressions: number;
  ctr: number;
  cpc: number;
  convRate: number;
  aov: number;
  /** Daily growth rate across the window, e.g. 0.004 = +0.4%/day. */
  trend: number;
  /** Daily budget cap; spend never exceeds ~1.02× it. */
  budget: number;
  /** Days ago the campaign started serving (older days stay empty). */
  startedDaysAgo: number;
  /** Days ago it stopped (paused). */
  pausedDaysAgo?: number;
  impressionShare?: number;
};

const DAYS = 120;

function series(profile: SeriesProfile, today: string): DailyPoint[] {
  const rand = rng(profile.seed);
  const points: DailyPoint[] = [];
  for (let i = DAYS; i >= 1; i--) {
    const date = addDays(today, -i);
    if (i > profile.startedDaysAgo || (profile.pausedDaysAgo !== undefined && i <= profile.pausedDaysAgo)) {
      points.push({ date, impressions: 0, clicks: 0, cost: 0, conversions: 0, conversionsValue: 0 });
      continue;
    }
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    // Weekend in the Gulf: Friday/Saturday shop more.
    const weekly = dow === 5 || dow === 6 ? 1.18 : dow === 0 ? 1.05 : 0.95;
    const growth = 1 + profile.trend * (DAYS - i);
    const noise = 0.82 + rand() * 0.36;
    const impressions = Math.round(profile.impressions * weekly * growth * noise);
    let clicks = Math.round(impressions * profile.ctr * (0.9 + rand() * 0.2));
    const cpc = profile.cpc * (0.88 + rand() * 0.24);
    let cost = clicks * cpc;
    const cap = profile.budget * (0.97 + rand() * 0.05);
    if (cost > cap) {
      clicks = Math.max(1, Math.floor(cap / cpc));
      cost = clicks * cpc;
    }
    const conversions = Math.round(clicks * profile.convRate * (0.75 + rand() * 0.5) * 10) / 10;
    const conversionsValue = Math.round(conversions * profile.aov * (0.85 + rand() * 0.3) * 100) / 100;
    points.push({
      date,
      impressions: Math.round(impressions * (cost >= cap * 0.99 ? 0.92 : 1)),
      clicks,
      cost: Math.round(cost * 100) / 100,
      conversions,
      conversionsValue,
      searchImprShare: profile.impressionShare ? Math.min(0.99, profile.impressionShare * (0.94 + rand() * 0.1)) : undefined,
    });
  }
  return points;
}

// ─── Builders ───────────────────────────────────────────────────────────────

const t = (text: string, pinned?: AdText["pinned"]): AdText => (pinned ? { text, pinned } : { text });

function campaign(c: Partial<Campaign> & Pick<Campaign, "id" | "name" | "type" | "budgetId" | "bidding">): Campaign {
  return {
    status: "ENABLED",
    objective: "SALES",
    networks: { googleSearch: true, searchPartners: false, displayNetwork: false },
    locations: [
      { id: "2682", name: "Saudi Arabia", kind: "Country" },
      { id: "2784", name: "United Arab Emirates", kind: "Country" },
    ],
    languages: ["Arabic", "English"],
    schedule: [],
    devices: { mobile: 0, desktop: 0, tablet: 0 },
    startDate: "2026-05-01",
    conversionActionIds: ["conv_purchase"],
    euPoliticalAds: false,
    servingIssues: [],
    labels: [],
    createdAt: "2026-05-01T09:00:00Z",
    ...c,
  };
}

function kw(id: string, adGroupId: string, text: string, matchType: MatchType, extra: Partial<Keyword> = {}): Keyword {
  return { id, adGroupId, text, matchType, status: "ENABLED", policy: "APPROVED", ...extra };
}

function neg(id: string, text: string, matchType: MatchType, level: NegativeKeyword["level"], parentId: string): NegativeKeyword {
  return { id, text, matchType, level, parentId };
}

// ─── Demo store account ────────────────────────────────────────────────────

export function buildDemoAccount(today = isoDay(new Date())): AccountData {
  const account: GoogleAccount = {
    customerId: "7316204458",
    name: "Stride Sportswear – KSA & UAE",
    currency: "USD",
    timeZone: "Asia/Riyadh",
    isManager: false,
    managerCustomerId: MANAGER_ACCOUNT.customerId,
    optimizationScore: 0.712,
    autoTagging: true,
    merchantCenterId: "512889034",
  };

  const budgets: CampaignBudget[] = [
    { id: "b_brand", name: "Brand – Search", amount: 40, shared: false, deliveryMethod: "STANDARD" },
    { id: "b_running", name: "Running Shoes – Search", amount: 120, shared: false, deliveryMethod: "STANDARD" },
    { id: "b_generic", name: "Generic Sportswear – Search", amount: 90, shared: false, deliveryMethod: "STANDARD" },
    { id: "b_pmax", name: "PMax – All Products", amount: 150, shared: false, deliveryMethod: "STANDARD" },
    { id: "b_shopping", name: "Shopping – Bestsellers", amount: 60, shared: false, deliveryMethod: "STANDARD" },
    { id: "b_remarketing", name: "Remarketing – Display", amount: 25, shared: false, deliveryMethod: "STANDARD" },
    { id: "b_demandgen", name: "Demand Gen – Summer Drop", amount: 50, shared: false, deliveryMethod: "STANDARD" },
  ];

  const campaigns: Campaign[] = [
    campaign({
      id: "c_brand",
      name: "Brand – Search",
      type: "SEARCH",
      budgetId: "b_brand",
      bidding: { type: "TARGET_IMPRESSION_SHARE", maxCpcLimit: 1.5 },
      labels: ["Brand"],
      startDate: "2026-03-10",
    }),
    campaign({
      id: "c_running",
      name: "Running Shoes – Search",
      type: "SEARCH",
      budgetId: "b_running",
      bidding: { type: "TARGET_CPA", targetCpa: 18 },
      servingIssues: ["LIMITED_BY_BUDGET"],
      labels: ["Non-brand", "Top seller"],
      devices: { mobile: 0.15, desktop: 0, tablet: -0.2 },
      schedule: [
        { day: "THURSDAY", startHour: 18, endHour: 24, bidModifier: 0.1 },
        { day: "FRIDAY", startHour: 0, endHour: 24, bidModifier: 0.15 },
      ],
      startDate: "2026-04-02",
    }),
    campaign({
      id: "c_generic",
      name: "Generic Sportswear – Search",
      type: "SEARCH",
      budgetId: "b_generic",
      bidding: { type: "MAXIMIZE_CLICKS", maxCpcLimit: 2.2 },
      networks: { googleSearch: true, searchPartners: true, displayNetwork: true },
      labels: ["Non-brand"],
      startDate: "2026-05-18",
    }),
    campaign({
      id: "c_pmax",
      name: "PMax – All Products",
      type: "PERFORMANCE_MAX",
      budgetId: "b_pmax",
      bidding: { type: "TARGET_ROAS", targetRoas: 4 },
      networks: { googleSearch: true, searchPartners: true, displayNetwork: true },
      merchantFeed: true,
      labels: ["Feed"],
      startDate: "2026-04-20",
    }),
    campaign({
      id: "c_shopping",
      name: "Shopping – Bestsellers",
      type: "SHOPPING",
      budgetId: "b_shopping",
      bidding: { type: "MAXIMIZE_CONVERSION_VALUE" },
      networks: { googleSearch: true, searchPartners: true, displayNetwork: false },
      merchantFeed: true,
      labels: ["Feed", "Top seller"],
      startDate: "2026-05-05",
    }),
    campaign({
      id: "c_remarketing",
      name: "Remarketing – Display",
      type: "DISPLAY",
      status: "PAUSED",
      budgetId: "b_remarketing",
      bidding: { type: "TARGET_CPA", targetCpa: 25 },
      networks: { googleSearch: false, searchPartners: false, displayNetwork: true },
      labels: ["Remarketing"],
      startDate: "2026-06-01",
    }),
    campaign({
      id: "c_demandgen",
      name: "Demand Gen – Summer Drop",
      type: "DEMAND_GEN",
      budgetId: "b_demandgen",
      bidding: { type: "MAXIMIZE_CONVERSIONS" },
      networks: { googleSearch: false, searchPartners: false, displayNetwork: false },
      servingIssues: ["LEARNING"],
      objective: "AWARENESS",
      startDate: addDays(today, -9),
    }),
  ];

  const daily: Record<string, DailyPoint[]> = {
    c_brand: series({ seed: 11, impressions: 1450, ctr: 0.21, cpc: 0.32, convRate: 0.14, aov: 92, trend: 0.001, budget: 40, startedDaysAgo: 120, impressionShare: 0.93 }, today),
    c_running: series({ seed: 23, impressions: 9200, ctr: 0.062, cpc: 0.84, convRate: 0.052, aov: 118, trend: 0.003, budget: 120, startedDaysAgo: 120, impressionShare: 0.54 }, today),
    c_generic: series({ seed: 37, impressions: 16800, ctr: 0.031, cpc: 0.71, convRate: 0.009, aov: 64, trend: -0.001, budget: 90, startedDaysAgo: 110 }, today),
    c_pmax: series({ seed: 41, impressions: 38000, ctr: 0.012, cpc: 0.58, convRate: 0.031, aov: 104, trend: 0.002, budget: 150, startedDaysAgo: 120 }, today),
    c_shopping: series({ seed: 53, impressions: 11500, ctr: 0.0105, cpc: 0.46, convRate: 0.038, aov: 97, trend: 0.0015, budget: 60, startedDaysAgo: 115 }, today),
    c_remarketing: series({ seed: 61, impressions: 21000, ctr: 0.0042, cpc: 0.38, convRate: 0.021, aov: 88, trend: 0, budget: 25, startedDaysAgo: 100, pausedDaysAgo: 18 }, today),
    c_demandgen: series({ seed: 73, impressions: 26000, ctr: 0.0064, cpc: 0.29, convRate: 0.006, aov: 79, trend: 0.02, budget: 50, startedDaysAgo: 9 }, today),
  };

  const adGroups: AdGroup[] = [
    { id: "ag_brand_core", campaignId: "c_brand", name: "Brand – Core", status: "ENABLED", type: "SEARCH_STANDARD" },
    { id: "ag_brand_product", campaignId: "c_brand", name: "Brand + Product", status: "ENABLED", type: "SEARCH_STANDARD" },
    { id: "ag_run_men", campaignId: "c_running", name: "Running Shoes – Men", status: "ENABLED", type: "SEARCH_STANDARD" },
    { id: "ag_run_women", campaignId: "c_running", name: "Running Shoes – Women", status: "ENABLED", type: "SEARCH_STANDARD" },
    { id: "ag_run_trail", campaignId: "c_running", name: "Trail Running", status: "ENABLED", type: "SEARCH_STANDARD" },
    { id: "ag_gen_sportswear", campaignId: "c_generic", name: "Sportswear – General", status: "ENABLED", type: "SEARCH_STANDARD", defaultCpcBid: 0.9 },
    { id: "ag_gen_gym", campaignId: "c_generic", name: "Gym Clothes", status: "ENABLED", type: "SEARCH_STANDARD", defaultCpcBid: 0.8 },
    { id: "ag_gen_deals", campaignId: "c_generic", name: "Activewear Deals", status: "PAUSED", type: "SEARCH_STANDARD", defaultCpcBid: 0.6 },
    { id: "ag_shop_all", campaignId: "c_shopping", name: "All Bestsellers", status: "ENABLED", type: "SHOPPING_PRODUCT_ADS" },
    { id: "ag_rm_cart", campaignId: "c_remarketing", name: "Cart Abandoners", status: "ENABLED", type: "DISPLAY_STANDARD" },
    { id: "ag_rm_visitors", campaignId: "c_remarketing", name: "Past Visitors 30d", status: "ENABLED", type: "DISPLAY_STANDARD" },
    { id: "ag_dg_summer", campaignId: "c_demandgen", name: "Summer Drop – Lookalikes", status: "ENABLED", type: "DEMAND_GEN" },
  ];

  const keywords: Keyword[] = [
    kw("k1", "ag_brand_core", "stride sportswear", "EXACT", { qualityScore: 10, qualityParts: { expectedCtr: "ABOVE_AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "ABOVE_AVERAGE" } }),
    kw("k2", "ag_brand_core", "stride", "PHRASE", { qualityScore: 9, qualityParts: { expectedCtr: "ABOVE_AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k3", "ag_brand_core", "stride store", "EXACT", { qualityScore: 10, qualityParts: { expectedCtr: "ABOVE_AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "ABOVE_AVERAGE" } }),
    kw("k4", "ag_brand_product", "stride running shoes", "PHRASE", { qualityScore: 9, qualityParts: { expectedCtr: "ABOVE_AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k5", "ag_brand_product", "stride leggings", "PHRASE", { qualityScore: 8, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k6", "ag_run_men", "men's running shoes", "PHRASE", { qualityScore: 8, qualityParts: { expectedCtr: "ABOVE_AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k7", "ag_run_men", "running shoes for men", "EXACT", { qualityScore: 8, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "ABOVE_AVERAGE" } }),
    kw("k8", "ag_run_men", "buy running shoes online", "PHRASE", { qualityScore: 7, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "AVERAGE", landingPage: "ABOVE_AVERAGE" } }),
    kw("k9", "ag_run_men", "best running shoes", "BROAD", { qualityScore: 5, qualityParts: { expectedCtr: "BELOW_AVERAGE", adRelevance: "AVERAGE", landingPage: "AVERAGE" } }),
    kw("k10", "ag_run_women", "women's running shoes", "PHRASE", { qualityScore: 8, qualityParts: { expectedCtr: "ABOVE_AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k11", "ag_run_women", "running shoes for women", "EXACT", { qualityScore: 9, qualityParts: { expectedCtr: "ABOVE_AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "ABOVE_AVERAGE" } }),
    kw("k12", "ag_run_women", "ladies sports shoes", "BROAD", { qualityScore: 6, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "BELOW_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k13", "ag_run_trail", "trail running shoes", "PHRASE", { qualityScore: 7, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k14", "ag_run_trail", "waterproof trail shoes", "PHRASE", { qualityScore: 6, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "AVERAGE", landingPage: "BELOW_AVERAGE" } }),
    kw("k15", "ag_gen_sportswear", "sportswear", "BROAD", { qualityScore: 4, qualityParts: { expectedCtr: "BELOW_AVERAGE", adRelevance: "AVERAGE", landingPage: "BELOW_AVERAGE" }, cpcBid: 1.1 }),
    kw("k16", "ag_gen_sportswear", "sports clothes", "BROAD", { qualityScore: 4, qualityParts: { expectedCtr: "BELOW_AVERAGE", adRelevance: "BELOW_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k17", "ag_gen_sportswear", "athletic wear", "PHRASE", { qualityScore: 5, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "AVERAGE", landingPage: "BELOW_AVERAGE" } }),
    kw("k18", "ag_gen_sportswear", "nike sportswear", "BROAD", { qualityScore: 3, policy: "APPROVED_LIMITED", qualityParts: { expectedCtr: "BELOW_AVERAGE", adRelevance: "BELOW_AVERAGE", landingPage: "BELOW_AVERAGE" } }),
    kw("k19", "ag_gen_gym", "gym clothes", "BROAD", { qualityScore: 5, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "AVERAGE", landingPage: "BELOW_AVERAGE" } }),
    kw("k20", "ag_gen_gym", "workout clothes", "PHRASE", { qualityScore: 6, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "AVERAGE", landingPage: "AVERAGE" } }),
    kw("k21", "ag_gen_gym", "gym wear women", "PHRASE", { qualityScore: 6, qualityParts: { expectedCtr: "AVERAGE", adRelevance: "ABOVE_AVERAGE", landingPage: "AVERAGE" } }),
    kw("k22", "ag_gen_deals", "cheap activewear", "BROAD", { status: "PAUSED", qualityScore: 3 }),
    kw("k23", "ag_gen_deals", "activewear sale", "PHRASE", { status: "PAUSED", qualityScore: 5 }),
  ];

  const negatives: NegativeKeyword[] = [
    neg("n1", "free", "BROAD", "LIST", "nl_universal"),
    neg("n2", "jobs", "BROAD", "LIST", "nl_universal"),
    neg("n3", "careers", "BROAD", "LIST", "nl_universal"),
    neg("n4", "second hand", "PHRASE", "LIST", "nl_universal"),
    neg("n5", "stride", "PHRASE", "CAMPAIGN", "c_generic"),
    neg("n6", "stride", "PHRASE", "CAMPAIGN", "c_running"),
    neg("n7", "kids", "BROAD", "AD_GROUP", "ag_run_women"),
  ];

  const ads: Ad[] = [
    {
      id: "ad1",
      adGroupId: "ag_brand_core",
      type: "RESPONSIVE_SEARCH_AD",
      status: "ENABLED",
      headlines: [
        t("Stride Official Store", "HEADLINE_1"),
        t("Free Delivery Over $50"),
        t("New Season Running Gear"),
        t("Shop Shoes, Leggings & More"),
        t("Easy 30-Day Returns"),
        t("Pay in 4 with Tabby"),
        t("Delivered in 1–3 Days"),
        t("Members Get 10% Off"),
        t("Built for Gulf Summers"),
        t("Top-Rated Sportswear"),
      ],
      descriptions: [
        t("Shop the official Stride store. Performance shoes and apparel, delivered across KSA & UAE."),
        t("Free delivery over $50, 30-day returns and split payments. Find your fit today."),
        t("Breathable fabrics made for heat. Run, train and recover in Stride."),
      ],
      finalUrl: `https://${DEMO_DOMAIN}/`,
      path1: "official",
      path2: "store",
      adStrength: "EXCELLENT",
      policy: "APPROVED",
    },
    {
      id: "ad2",
      adGroupId: "ag_brand_product",
      type: "RESPONSIVE_SEARCH_AD",
      status: "ENABLED",
      headlines: [
        t("Stride Running Shoes"),
        t("Stride Leggings & Tops"),
        t("Official Stride Store"),
        t("Free Delivery Over $50"),
        t("Shop the New Collection"),
        t("Easy 30-Day Returns"),
      ],
      descriptions: [
        t("Every Stride product in one place. Order today, delivered in 1–3 days."),
        t("Cushioned, light and built for distance. Find your Stride."),
      ],
      finalUrl: `https://${DEMO_DOMAIN}/collections/all`,
      path1: "shop",
      adStrength: "GOOD",
      policy: "APPROVED",
    },
    {
      id: "ad3",
      adGroupId: "ag_run_men",
      type: "RESPONSIVE_SEARCH_AD",
      status: "ENABLED",
      headlines: [
        t("Men's Running Shoes"),
        t("Light, Cushioned & Fast"),
        t("Free Delivery Over $50"),
        t("Shop 40+ Men's Styles"),
        t("Run Cooler in the Heat"),
        t("30-Day Comfort Guarantee"),
        t("New: Stride Glide 3"),
        t("Pay in 4 with Tabby"),
        t("Sizes 39 to 47"),
        t("Delivered in 1–3 Days"),
        t("Rated 4.8 by Runners"),
      ],
      descriptions: [
        t("Find men's running shoes for road, track and treadmill. Free delivery over $50."),
        t("Lightweight cushioning that keeps up with your pace. Try them for 30 days."),
        t("Breathable mesh uppers made for hot Gulf mornings. Order today."),
      ],
      finalUrl: `https://${DEMO_DOMAIN}/collections/mens-running-shoes`,
      path1: "men",
      path2: "running",
      adStrength: "EXCELLENT",
      policy: "APPROVED",
    },
    {
      id: "ad4",
      adGroupId: "ag_run_women",
      type: "RESPONSIVE_SEARCH_AD",
      status: "ENABLED",
      headlines: [
        t("Women's Running Shoes"),
        t("Light & Supportive Fit"),
        t("Free Delivery Over $50"),
        t("Shop 35+ Women's Styles"),
        t("Easy 30-Day Returns"),
        t("New Colours Just Landed"),
        t("Pay in 4 with Tabby"),
      ],
      descriptions: [
        t("Running shoes designed for women's feet. Cushioned, light and stylish."),
        t("Free delivery over $50 and 30-day returns. Find your perfect pair."),
      ],
      finalUrl: `https://${DEMO_DOMAIN}/collections/womens-running-shoes`,
      path1: "women",
      path2: "running",
      adStrength: "GOOD",
      policy: "APPROVED",
    },
    {
      id: "ad5",
      adGroupId: "ag_run_trail",
      type: "RESPONSIVE_SEARCH_AD",
      status: "ENABLED",
      headlines: [t("Trail Running Shoes"), t("Grip for Any Terrain"), t("Free Delivery Over $50"), t("Waterproof Options")],
      descriptions: [t("Trail shoes with aggressive grip and rock plates."), t("Shop trail running shoes for men and women.")],
      finalUrl: `https://${DEMO_DOMAIN}/collections/trail`,
      path1: "trail",
      adStrength: "AVERAGE",
      policy: "APPROVED",
    },
    {
      id: "ad6",
      adGroupId: "ag_gen_sportswear",
      type: "RESPONSIVE_SEARCH_AD",
      status: "ENABLED",
      headlines: [t("Sportswear Online"), t("Shop Sportswear"), t("Sportswear Store")],
      descriptions: [t("We sell sportswear."), t("Buy sportswear online.")],
      finalUrl: `https://${DEMO_DOMAIN}/`,
      adStrength: "POOR",
      policy: "APPROVED",
    },
    {
      id: "ad7",
      adGroupId: "ag_gen_sportswear",
      type: "RESPONSIVE_SEARCH_AD",
      status: "ENABLED",
      headlines: [t("#1 Sportswear Guaranteed"), t("Cheaper Than Nike"), t("Best Prices in Arabia"), t("Free Delivery Over $50")],
      descriptions: [t("Guaranteed lowest prices on all sportswear!!!"), t("Better than Nike and Adidas. Shop now.")],
      finalUrl: `https://${DEMO_DOMAIN}/`,
      adStrength: "AVERAGE",
      policy: "DISAPPROVED",
      policyTopics: [
        { topic: "Unverified claims", detail: "Superlative \"#1\" and \"Guaranteed\" need third-party verification shown on the landing page." },
        { topic: "Trademarks", detail: "\"Nike\" is a trademark used in ad text without authorisation." },
        { topic: "Punctuation", detail: "Repeated exclamation marks (\"!!!\") are not allowed." },
      ],
    },
    {
      id: "ad8",
      adGroupId: "ag_gen_gym",
      type: "RESPONSIVE_SEARCH_AD",
      status: "ENABLED",
      headlines: [t("Gym Clothes for Men & Women"), t("Breathable Workout Wear"), t("Free Delivery Over $50"), t("Shop Leggings & Tops"), t("Train Cooler")],
      descriptions: [t("Gym wear that moves with you. Shop leggings, shorts and tops."), t("Free delivery over $50 and 30-day returns.")],
      finalUrl: `https://${DEMO_DOMAIN}/collections/training`,
      path1: "gym",
      adStrength: "AVERAGE",
      policy: "APPROVED_LIMITED",
      policyTopics: [{ topic: "Limited by location", detail: "Some imagery on the landing page is limited in certain countries." }],
    },
    {
      id: "ad9",
      adGroupId: "ag_rm_cart",
      type: "RESPONSIVE_DISPLAY_AD",
      status: "ENABLED",
      headlines: [t("Still Thinking It Over?"), t("Your Cart Misses You")],
      longHeadline: "Complete your order today and get free delivery over $50",
      descriptions: [t("Your Stride favourites are waiting. Free delivery over $50.")],
      businessName: "Stride",
      finalUrl: `https://${DEMO_DOMAIN}/cart`,
      adStrength: "GOOD",
      policy: "APPROVED",
    },
    {
      id: "ad10",
      adGroupId: "ag_dg_summer",
      type: "DEMAND_GEN_AD",
      status: "ENABLED",
      headlines: [t("The Summer Drop Is Here"), t("Run Light This Summer")],
      longHeadline: "New breathable running collection, made for 45°C mornings",
      descriptions: [t("Discover the Summer Drop: ultra-light shoes and cooling apparel.")],
      businessName: "Stride",
      finalUrl: `https://${DEMO_DOMAIN}/collections/summer-drop`,
      adStrength: "GOOD",
      policy: "UNDER_REVIEW",
    },
  ];

  const assetGroups: AssetGroup[] = [
    {
      id: "asg_all",
      campaignId: "c_pmax",
      name: "All Products",
      status: "ENABLED",
      finalUrl: `https://${DEMO_DOMAIN}/`,
      headlines: ["Shop Stride Sportswear", "Free Delivery Over $50", "Run Cooler This Summer", "New Season Is Here", "Easy 30-Day Returns"],
      longHeadlines: ["Performance shoes and apparel made for Gulf summers", "Free delivery over $50 and 30-day returns on every order"],
      descriptions: ["Shoes, leggings and tops built for heat.", "Order today, delivered in 1–3 days across KSA & UAE."],
      businessName: "Stride",
      imageUrls: ["landscape-1", "square-1", "square-2", "portrait-1"],
      logoUrls: ["logo-square"],
      videoUrls: [],
      audienceSignal: "Purchasers (180d) + In-market: Athletic Apparel",
      searchThemes: ["running shoes", "sportswear online", "gym leggings"],
      listingGroups: ["All products"],
      adStrength: "GOOD",
    },
    {
      id: "asg_running",
      campaignId: "c_pmax",
      name: "Running",
      status: "ENABLED",
      finalUrl: `https://${DEMO_DOMAIN}/collections/running`,
      headlines: ["Running Shoes & Apparel", "Light, Cushioned & Fast", "Free Delivery Over $50"],
      longHeadlines: ["Everything you need for your next run, delivered in 1–3 days"],
      descriptions: ["Shoes and apparel for road and trail."],
      businessName: "Stride",
      imageUrls: ["landscape-2", "square-3"],
      logoUrls: ["logo-square"],
      videoUrls: [],
      audienceSignal: "In-market: Running Shoes",
      searchThemes: ["marathon shoes", "running gear"],
      listingGroups: ["Product type = Running"],
      adStrength: "AVERAGE",
    },
    {
      id: "asg_sale",
      campaignId: "c_pmax",
      name: "Summer Sale",
      status: "PAUSED",
      finalUrl: `https://${DEMO_DOMAIN}/collections/sale`,
      headlines: ["Summer Sale: Up to 40% Off", "Limited Time Only"],
      longHeadlines: ["Up to 40% off selected shoes and apparel this summer"],
      descriptions: ["Shop the summer sale before it ends."],
      businessName: "Stride",
      imageUrls: ["square-4"],
      logoUrls: ["logo-square"],
      videoUrls: [],
      searchThemes: [],
      listingGroups: ["Custom label 0 = sale"],
      adStrength: "POOR",
    },
  ];

  const assets: Asset[] = [
    { id: "as1", type: "SITELINK", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Men's Running", lines: ["40+ styles for road & track", "Free delivery over $50"], finalUrl: `https://${DEMO_DOMAIN}/collections/mens-running-shoes` },
    { id: "as2", type: "SITELINK", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Women's Running", lines: ["35+ styles, new colours", "Try them for 30 days"], finalUrl: `https://${DEMO_DOMAIN}/collections/womens-running-shoes` },
    { id: "as3", type: "SITELINK", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Summer Sale", lines: ["Up to 40% off", "Limited time only"], finalUrl: `https://${DEMO_DOMAIN}/collections/sale` },
    { id: "as4", type: "SITELINK", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Track Your Order", lines: ["Live delivery updates", "1–3 day delivery"], finalUrl: `https://${DEMO_DOMAIN}/pages/track` },
    { id: "as5", type: "CALLOUT", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Free Delivery Over $50" },
    { id: "as6", type: "CALLOUT", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "30-Day Returns" },
    { id: "as7", type: "CALLOUT", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Pay in 4 with Tabby" },
    { id: "as8", type: "CALLOUT", level: "CAMPAIGN", parentId: "c_running", status: "ENABLED", policy: "APPROVED", title: "Sizes 36 to 47" },
    { id: "as9", type: "STRUCTURED_SNIPPET", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Types", lines: ["Running shoes", "Leggings", "Training tops", "Shorts", "Socks"] },
    { id: "as10", type: "CALL", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "+966 11 555 0142", lines: ["Calls reported as conversions"] },
    { id: "as11", type: "PROMOTION", level: "CAMPAIGN", parentId: "c_running", status: "ENABLED", policy: "APPROVED", title: "Up to 40% off running shoes", lines: ["Occasion: Summer sale", "Ends in 12 days"], finalUrl: `https://${DEMO_DOMAIN}/collections/sale` },
    { id: "as12", type: "IMAGE", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Glide 3 – square", lines: ["1200 × 1200"] },
    { id: "as13", type: "BUSINESS_NAME", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Stride" },
    { id: "as14", type: "BUSINESS_LOGO", level: "ACCOUNT", status: "ENABLED", policy: "APPROVED", title: "Stride logo", lines: ["1200 × 1200"] },
    { id: "as15", type: "PRICE", level: "CAMPAIGN", parentId: "c_running", status: "PAUSED", policy: "UNDER_REVIEW", title: "Running shoes from $79", lines: ["Glide 3 · $129", "Pace Lite · $89", "Trail X · $149"] },
  ];

  const audiences: AudienceSegment[] = [
    { id: "aud_all", name: "All visitors (540 days)", kind: "REMARKETING", size: 184000 },
    { id: "aud_cart", name: "Cart abandoners (30 days)", kind: "REMARKETING", size: 9200 },
    { id: "aud_buyers", name: "Purchasers (180 days)", kind: "REMARKETING", size: 14300 },
    { id: "aud_vip", name: "Customer list – VIP", kind: "CUSTOMER_MATCH", size: 5100, description: "Top 10% customers by revenue" },
    { id: "aud_im_apparel", name: "Athletic Apparel", kind: "IN_MARKET" },
    { id: "aud_im_running", name: "Running Shoes", kind: "IN_MARKET" },
    { id: "aud_aff_runners", name: "Running Enthusiasts", kind: "AFFINITY" },
    { id: "aud_custom_comp", name: "Searched competitor brands", kind: "CUSTOM", description: "People who searched nike running, adidas ultraboost, asics gel" },
  ];

  const audienceTargets: AudienceTarget[] = [
    { id: "at1", segmentId: "aud_buyers", level: "CAMPAIGN", parentId: "c_running", mode: "OBSERVATION", bidModifier: 0.2 },
    { id: "at2", segmentId: "aud_im_running", level: "CAMPAIGN", parentId: "c_running", mode: "OBSERVATION" },
    { id: "at3", segmentId: "aud_cart", level: "AD_GROUP", parentId: "ag_rm_cart", mode: "TARGETING" },
    { id: "at4", segmentId: "aud_all", level: "AD_GROUP", parentId: "ag_rm_visitors", mode: "TARGETING" },
    { id: "at5", segmentId: "aud_aff_runners", level: "AD_GROUP", parentId: "ag_dg_summer", mode: "TARGETING" },
    { id: "at6", segmentId: "aud_vip", level: "CAMPAIGN", parentId: "c_brand", mode: "OBSERVATION" },
  ];

  const conversions: ConversionAction[] = [
    { id: "conv_purchase", name: "Purchase", category: "PURCHASE", source: "WEBSITE", status: "ACTIVE", primary: true, countingType: "MANY_PER_CLICK", useDynamicValue: true, defaultValue: 90, clickThroughWindowDays: 30, attribution: "DATA_DRIVEN", conversions30d: 0 },
    { id: "conv_cart", name: "Add to cart", category: "ADD_TO_CART", source: "WEBSITE", status: "ACTIVE", primary: false, countingType: "MANY_PER_CLICK", useDynamicValue: false, clickThroughWindowDays: 30, attribution: "DATA_DRIVEN", conversions30d: 0 },
    { id: "conv_checkout", name: "Begin checkout", category: "BEGIN_CHECKOUT", source: "WEBSITE", status: "ACTIVE", primary: false, countingType: "ONE_PER_CLICK", useDynamicValue: false, clickThroughWindowDays: 30, attribution: "DATA_DRIVEN", conversions30d: 0 },
    { id: "conv_signup", name: "Newsletter sign-up", category: "SIGNUP", source: "GOOGLE_ANALYTICS", status: "NO_RECENT_CONVERSIONS", primary: false, countingType: "ONE_PER_CLICK", useDynamicValue: false, defaultValue: 2, clickThroughWindowDays: 30, attribution: "LAST_CLICK", conversions30d: 0 },
    { id: "conv_call", name: "Calls from ads", category: "PHONE_CALL_LEAD", source: "PHONE_CALLS", status: "UNVERIFIED", primary: false, countingType: "ONE_PER_CLICK", useDynamicValue: false, defaultValue: 15, clickThroughWindowDays: 30, attribution: "LAST_CLICK", conversions30d: 0 },
  ];

  const st = (id: string, text: string, campaignId: string, adGroupId: string, matchedVia: SearchTerm["matchedVia"], share: number, efficiency: number, keywordId?: string, status: SearchTerm["status"] = "NONE"): SearchTerm => ({
    id, text, campaignId, adGroupId, matchedVia, share, efficiency, keywordId, status,
  });

  const searchTerms: SearchTerm[] = [
    st("s1", "stride sportswear", "c_brand", "ag_brand_core", "EXACT", 5, 1.1, "k1", "ADDED"),
    st("s2", "stride store riyadh", "c_brand", "ag_brand_core", "PHRASE", 2, 1.2, "k2"),
    st("s3", "stride discount code", "c_brand", "ag_brand_core", "PHRASE", 1.4, 0.7, "k2"),
    st("s4", "stride running shoes review", "c_brand", "ag_brand_product", "PHRASE", 1.2, 0.6, "k4"),
    st("s5", "men's running shoes", "c_running", "ag_run_men", "PHRASE", 4, 1.2, "k6", "ADDED"),
    st("s6", "buy running shoes online saudi", "c_running", "ag_run_men", "PHRASE", 2.2, 1.5, "k8"),
    st("s7", "best running shoes for flat feet", "c_running", "ag_run_men", "BROAD", 1.8, 1.1, "k9"),
    st("s8", "running shoes size 45", "c_running", "ag_run_men", "BROAD", 1.1, 1.4, "k9"),
    st("s9", "how to choose running shoes", "c_running", "ag_run_men", "BROAD", 1.6, 0.1, "k9"),
    st("s10", "women's running shoes sale", "c_running", "ag_run_women", "PHRASE", 2.5, 1.4, "k10"),
    st("s11", "pink running shoes women", "c_running", "ag_run_women", "BROAD", 1.2, 1.2, "k12"),
    st("s12", "trail running shoes waterproof", "c_running", "ag_run_trail", "PHRASE", 1.5, 1.2, "k14"),
    st("s13", "free sportswear samples", "c_generic", "ag_gen_sportswear", "BROAD", 2.2, 0, "k15"),
    st("s14", "sportswear jobs riyadh", "c_generic", "ag_gen_sportswear", "BROAD", 1.9, 0, "k15"),
    st("s15", "nike outlet near me", "c_generic", "ag_gen_sportswear", "BROAD", 3.1, 0.05, "k18"),
    st("s16", "sportswear wholesale suppliers", "c_generic", "ag_gen_sportswear", "BROAD", 1.6, 0, "k15"),
    st("s17", "how to wash sportswear", "c_generic", "ag_gen_sportswear", "BROAD", 1.4, 0, "k16"),
    st("s18", "athletic wear online", "c_generic", "ag_gen_sportswear", "PHRASE", 1.3, 1.6, "k17"),
    st("s19", "gym clothes for women", "c_generic", "ag_gen_gym", "BROAD", 2.4, 1.3, "k19"),
    st("s20", "gym clothes ideas", "c_generic", "ag_gen_gym", "BROAD", 1.2, 0, "k19"),
    st("s21", "used gym clothes", "c_generic", "ag_gen_gym", "BROAD", 0.9, 0, "k19"),
    st("s22", "workout clothes men", "c_generic", "ag_gen_gym", "PHRASE", 1.7, 1.2, "k20"),
    st("s23", "running shorts men", "c_pmax", "", "PMAX", 2, 1.2),
    st("s24", "lightweight running shoes", "c_pmax", "", "PMAX", 2.5, 1.3),
    st("s25", "stride glide 3", "c_pmax", "", "PMAX", 1.2, 1.8),
  ];

  const weights: AccountData["weights"] = {
    ag_brand_core: { share: 0.7, efficiency: 1.05 },
    ag_brand_product: { share: 0.3, efficiency: 0.9 },
    ag_run_men: { share: 0.48, efficiency: 1.1 },
    ag_run_women: { share: 0.37, efficiency: 1.05 },
    ag_run_trail: { share: 0.15, efficiency: 0.7 },
    ag_gen_sportswear: { share: 0.62, efficiency: 0.5 },
    ag_gen_gym: { share: 0.38, efficiency: 1.8 },
    ag_gen_deals: { share: 0, efficiency: 0 },
    ag_shop_all: { share: 1, efficiency: 1 },
    ag_rm_cart: { share: 0.55, efficiency: 1.4 },
    ag_rm_visitors: { share: 0.45, efficiency: 0.5 },
    ag_dg_summer: { share: 1, efficiency: 1 },
    asg_all: { share: 0.68, efficiency: 1 },
    asg_running: { share: 0.32, efficiency: 1.1 },
    asg_sale: { share: 0, efficiency: 0 },
    k1: { share: 0.55, efficiency: 1.1 }, k2: { share: 0.3, efficiency: 0.9 }, k3: { share: 0.15, efficiency: 1 },
    k4: { share: 0.6, efficiency: 1.1 }, k5: { share: 0.4, efficiency: 0.85 },
    k6: { share: 0.34, efficiency: 1.2 }, k7: { share: 0.22, efficiency: 1.25 }, k8: { share: 0.2, efficiency: 1.3 }, k9: { share: 0.24, efficiency: 0.35 },
    k10: { share: 0.45, efficiency: 1.1 }, k11: { share: 0.3, efficiency: 1.2 }, k12: { share: 0.25, efficiency: 0.6 },
    k13: { share: 0.62, efficiency: 1 }, k14: { share: 0.38, efficiency: 1 },
    k15: { share: 0.38, efficiency: 0.15 }, k16: { share: 0.22, efficiency: 0.1 }, k17: { share: 0.16, efficiency: 2.6 }, k18: { share: 0.24, efficiency: 0.05 },
    k19: { share: 0.45, efficiency: 0.9 }, k20: { share: 0.33, efficiency: 1.2 }, k21: { share: 0.22, efficiency: 1 },
    ad1: { share: 1, efficiency: 1 }, ad2: { share: 1, efficiency: 1 }, ad3: { share: 1, efficiency: 1 }, ad4: { share: 1, efficiency: 1 }, ad5: { share: 1, efficiency: 1 },
    ad6: { share: 1, efficiency: 1 }, ad7: { share: 0, efficiency: 0 }, ad8: { share: 1, efficiency: 1 }, ad9: { share: 1, efficiency: 1 }, ad10: { share: 1, efficiency: 1 },
  };

  const recommendations: Recommendation[] = [
    {
      id: "rec_budget_running",
      type: "CAMPAIGN_BUDGET",
      category: "BIDDING_BUDGETS",
      title: "Raise your budget",
      description: "Running Shoes – Search is limited by budget and missed about 46% of eligible impressions last week.",
      scoreUplift: 6.4,
      campaignId: "c_running",
      impact: "+38 conversions / week at a similar CPA",
      status: "ACTIVE",
      ops: [{ kind: "budget.update", budgetId: "b_running", amount: 185 }],
    },
    {
      id: "rec_rsa_generic",
      type: "RESPONSIVE_SEARCH_AD_IMPROVE_AD_STRENGTH",
      category: "ADS_ASSETS",
      title: "Improve your responsive search ads",
      description: "1 ad in Generic Sportswear – Search has Poor ad strength. Add unique headlines that use your keywords.",
      scoreUplift: 3.1,
      campaignId: "c_generic",
      impact: "Up to +12% clicks for this ad",
      status: "ACTIVE",
      ops: [],
    },
    {
      id: "rec_sitelinks_generic",
      type: "SITELINK_ASSET",
      category: "ADS_ASSETS",
      title: "Add sitelink assets",
      description: "Campaign-level sitelinks for Generic Sportswear – Search help people go straight to the category they want.",
      scoreUplift: 1.8,
      campaignId: "c_generic",
      status: "ACTIVE",
      ops: [
        {
          kind: "asset.create",
          assets: [
            { id: "as_rec_1", type: "SITELINK", level: "CAMPAIGN", parentId: "c_generic", status: "ENABLED", policy: "UNDER_REVIEW", title: "Gym Leggings", lines: ["Squat-proof fabrics", "Free delivery over $50"], finalUrl: `https://${DEMO_DOMAIN}/collections/leggings` },
            { id: "as_rec_2", type: "SITELINK", level: "CAMPAIGN", parentId: "c_generic", status: "ENABLED", policy: "UNDER_REVIEW", title: "Training Tops", lines: ["Breathable & quick-dry", "New colours"], finalUrl: `https://${DEMO_DOMAIN}/collections/tops` },
          ],
        },
      ],
    },
    {
      id: "rec_broad_running",
      type: "USE_BROAD_MATCH_KEYWORD",
      category: "KEYWORDS_TARGETING",
      title: "Use broad match with Smart Bidding",
      description: "Expand reach in Running Shoes – Search by switching phrase keywords to broad match while Target CPA guards cost.",
      scoreUplift: 2.6,
      campaignId: "c_running",
      impact: "+9% conversions at similar CPA",
      status: "ACTIVE",
      ops: [
        { kind: "keyword.update", keywordId: "k6", patch: { matchType: "BROAD" } },
        { kind: "keyword.update", keywordId: "k10", patch: { matchType: "BROAD" } },
      ],
    },
    {
      id: "rec_troas_shopping",
      type: "TARGET_ROAS_OPT_IN",
      category: "BIDDING_BUDGETS",
      title: "Set a target ROAS",
      description: "Shopping – Bestsellers has steady conversion value. Bidding to a 450% target ROAS can raise value at the same spend.",
      scoreUplift: 2.2,
      campaignId: "c_shopping",
      status: "ACTIVE",
      ops: [{ kind: "campaign.update", campaignId: "c_shopping", patch: { bidding: { type: "TARGET_ROAS", targetRoas: 4.5 } } }],
    },
    {
      id: "rec_enhanced_conv",
      type: "ENHANCED_CONVERSIONS",
      category: "MEASUREMENT",
      title: "Turn on enhanced conversions",
      description: "Send hashed first-party data with conversions to recover conversions lost to cookie limits.",
      scoreUplift: 1.5,
      impact: "Typically +5% measured conversions",
      status: "ACTIVE",
      ops: [],
    },
    {
      id: "rec_fix_disapproved",
      type: "DISAPPROVED_AD",
      category: "REPAIRS",
      title: "Fix a disapproved ad",
      description: "1 ad in Sportswear – General is disapproved for unverified claims and trademark use.",
      scoreUplift: 0.9,
      campaignId: "c_generic",
      status: "ACTIVE",
      ops: [],
    },
  ];

  const data: AccountData = {
    account,
    campaigns,
    budgets,
    adGroups,
    keywords,
    negatives,
    negativeLists: [{ id: "nl_universal", name: "Universal negatives", campaignIds: ["c_brand", "c_running", "c_generic"] }],
    ads,
    assets,
    assetGroups,
    audiences,
    audienceTargets,
    conversions,
    searchTerms,
    recommendations,
    ...buildDemoExtras(today),
    daily,
    weights,
  };
  data.assetGroups = data.assetGroups.map((g) => ({ ...g, assetPerformance: ASSET_RATINGS[g.id] }));
  data.account = {
    ...data.account,
    enhancedConversions: false,
    excludedContent: ["Tragedy & conflict", "Sensitive social issues", "Live streaming video"],
    brandExclusions: [],
  };
  data.campaigns = data.campaigns.map((c) => (c.type === "PERFORMANCE_MAX" ? { ...c, finalUrlExpansion: true } : c));

  // Conversion counts follow the series so the Goals page agrees with reports.
  const last30Start = addDays(today, -30);
  const purchases = Object.values(daily)
    .flat()
    .filter((p) => p.date >= last30Start)
    .reduce((s, p) => s + p.conversions, 0);
  data.conversions = conversions.map((c) => ({
    ...c,
    conversions30d:
      c.id === "conv_purchase" ? Math.round(purchases) : c.id === "conv_cart" ? Math.round(purchases * 4.2) : c.id === "conv_checkout" ? Math.round(purchases * 1.9) : 0,
  }));

  return data;
}

/** A fresh account with nothing in it, to show campaign creation from zero. */
export function buildEmptyAccount(): AccountData {
  return {
    account: {
      customerId: "9082215570",
      name: "Stride – Kuwait (new)",
      currency: "USD",
      timeZone: "Asia/Kuwait",
      isManager: false,
      managerCustomerId: MANAGER_ACCOUNT.customerId,
      optimizationScore: 0,
      autoTagging: true,
    },
    campaigns: [],
    budgets: [],
    adGroups: [],
    keywords: [],
    negatives: [],
    negativeLists: [],
    ads: [],
    assets: [],
    assetGroups: [],
    audiences: [{ id: "aud_all_kw", name: "All visitors (540 days)", kind: "REMARKETING", size: 0 }],
    audienceTargets: [],
    conversions: [
      { id: "conv_purchase_kw", name: "Purchase", category: "PURCHASE", source: "WEBSITE", status: "UNVERIFIED", primary: true, countingType: "MANY_PER_CLICK", useDynamicValue: true, clickThroughWindowDays: 30, attribution: "DATA_DRIVEN", conversions30d: 0 },
    ],
    searchTerms: [],
    recommendations: [],
    ...emptyExtras(),
    daily: {},
    weights: {},
  };
}

/** Catalog products the agent draws on for ad copy (stands in for the workspace catalog). */
export const CATALOG_SAMPLE = [
  { title: "Stride Glide 3 Running Shoe", category: "Running shoes", price: 129, keywords: ["cushioned running shoes", "daily trainer", "road running shoes"], features: ["Nitro foam midsole", "Breathable knit upper", "230 g"] },
  { title: "Stride Pace Lite", category: "Running shoes", price: 89, keywords: ["lightweight running shoes", "beginner running shoes"], features: ["Only 198 g", "Reflective details", "Wide fit available"] },
  { title: "Stride Trail X", category: "Trail shoes", price: 149, keywords: ["trail running shoes", "waterproof trail shoes"], features: ["Vibram outsole", "Rock plate", "Water-resistant upper"] },
  { title: "CoolCore Training Leggings", category: "Leggings", price: 59, keywords: ["gym leggings", "squat proof leggings"], features: ["Squat-proof", "Phone pocket", "UPF 50"] },
  { title: "AirFlow Training Tee", category: "Tops", price: 35, keywords: ["breathable gym shirt", "quick dry t-shirt"], features: ["Quick-dry", "Anti-odour", "Laser-cut vents"] },
];

/** A smaller mature account, so the manager view has more than one to compare. */
export function buildSecondAccount(today = isoDay(new Date())): AccountData {
  const d = buildDemoAccount(today);
  const keep = new Set(["c_brand", "c_running", "c_pmax"]);
  const egypt = [{ id: "2818", name: "Egypt", kind: "Country" as const }];
  const daily: AccountData["daily"] = {};
  for (const id of keep)
    daily[id] = d.daily[id].map((p) => ({ ...p, impressions: Math.round(p.impressions * 0.5), clicks: Math.round(p.clicks * 0.45), cost: p.cost * 0.32, conversions: p.conversions * 0.4, conversionsValue: p.conversionsValue * 0.3 }));
  const campaigns = d.campaigns.filter((c) => keep.has(c.id)).map((c) => ({ ...c, locations: egypt, languages: ["Arabic"], servingIssues: [] }));
  const adGroupIds = new Set(d.adGroups.filter((g) => keep.has(g.campaignId)).map((g) => g.id));
  return {
    ...d,
    account: { ...d.account, customerId: "5520983316", name: "Stride – Egypt", timeZone: "Africa/Cairo", optimizationScore: 0.64, merchantCenterId: undefined },
    campaigns,
    budgets: d.budgets.filter((b) => campaigns.some((c) => c.budgetId === b.id)).map((b) => ({ ...b, amount: Math.round(b.amount * 0.35) })),
    adGroups: d.adGroups.filter((g) => adGroupIds.has(g.id)),
    keywords: d.keywords.filter((k) => adGroupIds.has(k.adGroupId)),
    ads: d.ads.filter((a) => adGroupIds.has(a.adGroupId)),
    assetGroups: d.assetGroups.filter((g) => keep.has(g.campaignId)),
    searchTerms: d.searchTerms.filter((t) => keep.has(t.campaignId)),
    recommendations: d.recommendations.filter((r) => !r.campaignId || keep.has(r.campaignId)).slice(0, 3),
    negatives: d.negatives.filter((n) => n.level !== "CAMPAIGN" || keep.has(n.parentId)),
    negativeLists: d.negativeLists.map((l) => ({ ...l, campaignIds: l.campaignIds.filter((id) => keep.has(id)) })),
    products: [],
    listingGroups: [],
    experiments: [],
    contentTargets: [],
    demographics: [],
    alerts: [],
    rules: d.rules.filter((r) => r.id === "rule_zero_conv"),
    links: d.links.map((l) => (l.kind === "MERCHANT_CENTER" ? { ...l, status: "NOT_LINKED" as const } : l)),
    daily,
  };
}

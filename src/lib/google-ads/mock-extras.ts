// Demo data for Shopping, monitoring, experiments, content targeting and
// linked accounts. Split from mock-data.ts to keep each file readable.

import { addDays } from "./metrics";
import type {
  Alert,
  AssetRating,
  AutomatedRule,
  ContentTarget,
  DemographicTarget,
  Experiment,
  LinkedAccount,
  ListingGroup,
  OfflineImport,
  Product,
  ProductIssue,
  ScheduledReport,
  ValueRule,
} from "./types";

export type Extras = {
  products: Product[];
  listingGroups: ListingGroup[];
  rules: AutomatedRule[];
  alerts: Alert[];
  scheduledReports: ScheduledReport[];
  experiments: Experiment[];
  contentTargets: ContentTarget[];
  demographics: DemographicTarget[];
  links: LinkedAccount[];
  valueRules: ValueRule[];
  offlineImports: OfflineImport[];
};

const ISSUES: Record<string, ProductIssue> = {
  gtin: { code: "missing_gtin", detail: "Missing GTIN. Products with a GTIN get more visibility.", severity: "LIMITED", fixable: true },
  image: { code: "image_too_small", detail: "Image is smaller than 100 × 100 px for apparel (min. 250 × 250).", severity: "DISAPPROVED", fixable: true },
  watermark: { code: "image_promo_overlay", detail: "Image has a promotional overlay (\"SALE\" text).", severity: "DISAPPROVED", fixable: true },
  price: { code: "price_mismatch", detail: "Price on the landing page ($84) doesn't match the feed ($89).", severity: "DISAPPROVED", fixable: true },
  size: { code: "missing_size", detail: "Apparel needs size, color, gender and age group.", severity: "LIMITED", fixable: true },
  title: { code: "title_too_long", detail: "Title is over 150 characters and gets truncated.", severity: "LIMITED", fixable: true },
  policy: { code: "restricted_claim", detail: "\"Medical-grade compression\" is a health claim that needs proof.", severity: "DISAPPROVED", fixable: false },
};

const P = (
  id: string,
  title: string,
  productType: string,
  price: number,
  share: number,
  efficiency: number,
  extra: Partial<Product> = {}
): Product => ({
  id,
  title,
  brand: "Stride",
  productType,
  price,
  availability: "IN_STOCK",
  gtin: `62${id.replace(/\D/g, "").padStart(11, "0")}`,
  status: "APPROVED",
  issues: [],
  share,
  efficiency,
  ...extra,
});

export function buildDemoExtras(today: string): Extras {
  const products: Product[] = [
    P("sku-glide3-m", "Stride Glide 3 Men's Running Shoe – Black/Volt", "Running > Road shoes", 129, 9, 1.5, { customLabel0: "bestseller", benchmarkPrice: 135 }),
    P("sku-glide3-w", "Stride Glide 3 Women's Running Shoe – Lilac", "Running > Road shoes", 129, 7.5, 1.4, { customLabel0: "bestseller", benchmarkPrice: 135 }),
    P("sku-pace-m", "Stride Pace Lite Men's Lightweight Running Shoe", "Running > Road shoes", 89, 6, 1.2, { benchmarkPrice: 84, issues: [ISSUES.price], status: "DISAPPROVED" }),
    P("sku-pace-w", "Stride Pace Lite Women's Lightweight Running Shoe", "Running > Road shoes", 89, 5, 1.1, { benchmarkPrice: 92 }),
    P("sku-trailx-m", "Stride Trail X Men's Waterproof Trail Shoe", "Running > Trail shoes", 149, 4, 1.3, { customLabel0: "bestseller" }),
    P("sku-trailx-w", "Stride Trail X Women's Waterproof Trail Shoe", "Running > Trail shoes", 149, 3, 1.1),
    P("sku-tempo", "Stride Tempo Racer Carbon Plate Shoe", "Running > Racing shoes", 219, 2.5, 0.6, { benchmarkPrice: 199 }),
    P("sku-kids-dash", "Stride Kids Dash Running Shoe", "Running > Kids", 59, 2, 0.4, { issues: [ISSUES.image], status: "DISAPPROVED" }),
    P("sku-leg-core", "CoolCore Training Leggings – High Waist", "Apparel > Leggings", 59, 6.5, 1.3, { customLabel0: "bestseller", issues: [ISSUES.size], status: "LIMITED" }),
    P("sku-leg-pocket", "CoolCore Leggings with Phone Pocket", "Apparel > Leggings", 64, 4.5, 1.2),
    P("sku-leg-7-8", "CoolCore 7/8 Leggings – Sale", "Apparel > Leggings", 69, 3, 1.0, { salePrice: 45, customLabel0: "sale", issues: [ISSUES.watermark], status: "DISAPPROVED" }),
    P("sku-tee-air", "AirFlow Training Tee – Men", "Apparel > Tops", 35, 5, 1.0, { issues: [ISSUES.size], status: "LIMITED" }),
    P("sku-tee-air-w", "AirFlow Training Tee – Women", "Apparel > Tops", 35, 4, 1.1),
    P("sku-tank", "AirFlow Racer Tank", "Apparel > Tops", 29, 2, 0.7, { customLabel0: "sale", salePrice: 22 }),
    P("sku-shorts-5", "Stride 5\" Running Shorts with Liner", "Apparel > Shorts", 39, 4.5, 1.2),
    P("sku-shorts-7", "Stride 7\" Training Shorts", "Apparel > Shorts", 39, 3, 0.9, { gtin: undefined, issues: [ISSUES.gtin], status: "LIMITED" }),
    P("sku-jacket", "Stride StormShell Running Jacket", "Apparel > Outerwear", 119, 1.5, 0.5, { availability: "OUT_OF_STOCK" }),
    P("sku-socks-3", "Stride Cushion Running Socks (3 Pack)", "Accessories > Socks", 19, 5, 1.4, { customLabel0: "bestseller" }),
    P("sku-compress", "Stride Recovery Compression Socks", "Accessories > Socks", 29, 1.5, 0.3, { issues: [ISSUES.policy], status: "DISAPPROVED" }),
    P("sku-cap", "Stride Lightweight Running Cap", "Accessories > Headwear", 25, 2, 0.8, { gtin: undefined, issues: [ISSUES.gtin], status: "LIMITED" }),
    P("sku-belt", "Stride Running Belt – Phone & Keys", "Accessories > Bags", 22, 1.8, 1.0),
    P("sku-bottle", "Stride Insulated Bottle 750ml", "Accessories > Hydration", 24, 1.2, 0.5, { title: "Stride Insulated Bottle 750ml Stainless Steel Double Wall Vacuum Water Bottle for Running Gym Hiking Cycling Sports Outdoor Keeps Cold 24h Hot 12h BPA Free Leakproof", issues: [ISSUES.title], status: "LIMITED" }),
    P("sku-glide2", "Stride Glide 2 Running Shoe (Last Season)", "Running > Road shoes", 79, 2.5, 0.9, { customLabel0: "clearance", salePrice: 59 }),
    P("sku-newdrop", "Stride Summer Drop Ultralight Shoe", "Running > Road shoes", 139, 0.5, 1.0, { status: "PENDING" }),
  ];

  const listingGroups: ListingGroup[] = [
    { id: "lg_root", campaignId: "c_shopping", dimension: "ALL", value: "All products" },
    { id: "lg_run", campaignId: "c_shopping", parentId: "lg_root", dimension: "PRODUCT_TYPE", value: "Running" },
    { id: "lg_app", campaignId: "c_shopping", parentId: "lg_root", dimension: "PRODUCT_TYPE", value: "Apparel" },
    { id: "lg_acc", campaignId: "c_shopping", parentId: "lg_root", dimension: "PRODUCT_TYPE", value: "Accessories" },
    { id: "lg_other", campaignId: "c_shopping", parentId: "lg_root", dimension: "OTHERS", value: "Everything else" },
    { id: "lg_run_best", campaignId: "c_shopping", parentId: "lg_run", dimension: "CUSTOM_LABEL_0", value: "bestseller" },
    { id: "lg_run_clear", campaignId: "c_shopping", parentId: "lg_run", dimension: "CUSTOM_LABEL_0", value: "clearance", excluded: true },
    { id: "lg_run_other", campaignId: "c_shopping", parentId: "lg_run", dimension: "OTHERS", value: "Everything else in Running" },
  ];

  const rules: AutomatedRule[] = [
    {
      id: "rule_zero_conv",
      name: "Alert: campaign spends $100 with no conversions",
      campaignIds: [],
      condition: { metric: "cost", op: ">", value: 100, window: "TODAY" },
      action: "NOTIFY",
      frequency: "HOURLY",
      enabled: true,
      createdBy: "AGENT",
      lastRun: addDays(today, 0) + "T09:00:00Z",
      lastResult: "No campaign matched",
    },
    {
      id: "rule_cpa_guard",
      name: "Pause keywords with CPA over $60 (7 days)",
      campaignIds: ["c_generic", "c_running"],
      condition: { metric: "cpa", op: ">", value: 60, window: "LAST_7_DAYS" },
      action: "PAUSE_KEYWORDS",
      frequency: "DAILY",
      enabled: true,
      createdBy: "USER",
      lastRun: addDays(today, -1) + "T06:00:00Z",
      lastResult: "Paused 1 keyword: sportswear (broad)",
    },
    {
      id: "rule_weekend",
      name: "Raise Running Shoes budget 20% on weekends",
      campaignIds: ["c_running"],
      condition: { metric: "roas", op: ">", value: 4, window: "LAST_7_DAYS" },
      action: "RAISE_BUDGET",
      amount: 20,
      frequency: "WEEKLY",
      enabled: false,
      createdBy: "USER",
    },
  ];

  const alerts: Alert[] = [
    { id: "al1", at: addDays(today, 0) + "T07:12:00Z", severity: "CRITICAL", title: "4 products disapproved in Merchant Center", body: "Pace Lite (men), Kids Dash, CoolCore 7/8 and Recovery Compression Socks stopped serving.", prompt: "Fix my Merchant Center product issues", read: false },
    { id: "al2", at: addDays(today, 0) + "T06:00:00Z", severity: "WARNING", title: "Running Shoes – Search is limited by budget", body: "It ran out of budget at 6 pm yesterday and missed ~46% of impressions.", campaignId: "c_running", prompt: "Should I move budget between campaigns?", read: false },
    { id: "al3", at: addDays(today, -1) + "T06:00:00Z", severity: "WARNING", title: "Rule paused 1 keyword", body: "\"sportswear\" (broad) in Sportswear – General had a $71 CPA over 7 days.", ruleId: "rule_cpa_guard", read: false },
    { id: "al4", at: addDays(today, -2) + "T10:30:00Z", severity: "INFO", title: "Experiment reached significance", body: "Target ROAS 450% on Shopping – Bestsellers: +14% conversion value at 92% confidence.", prompt: "Show my experiments", read: true },
    { id: "al5", at: addDays(today, -3) + "T08:00:00Z", severity: "INFO", title: "Demand Gen – Summer Drop is learning", body: "Smart Bidding needs ~50 conversions; expect results to settle in about a week.", campaignId: "c_demandgen", read: true },
  ];

  const scheduledReports: ScheduledReport[] = [
    { id: "sr1", name: "Weekly performance by campaign type", segment: "campaignType", metrics: ["cost", "conversions", "conversionsValue", "roas"], frequency: "WEEKLY", recipients: ["owner@stride-demo.com"], format: "PDF", nextRun: addDays(today, 3) },
  ];

  const experiments: Experiment[] = [
    {
      id: "exp_troas",
      name: "Target ROAS 450% on Shopping",
      baseCampaignId: "c_shopping",
      change: "Switch bidding from Maximize conversion value to Target ROAS 450%",
      ops: [{ kind: "campaign.update", campaignId: "c_shopping", patch: { bidding: { type: "TARGET_ROAS", targetRoas: 4.5 } } }],
      split: 50,
      status: "RUNNING",
      startDate: addDays(today, -21),
      endDate: addDays(today, 9),
      result: { conversions: 0.06, cpa: -0.04, roas: 0.14, confidence: 0.92 },
    },
    {
      id: "exp_broad",
      name: "Broad match on Running Shoes",
      baseCampaignId: "c_running",
      change: "Turn phrase keywords into broad match with Target CPA",
      ops: [],
      split: 50,
      status: "ENDED",
      startDate: addDays(today, -70),
      endDate: addDays(today, -40),
      result: { conversions: 0.03, cpa: 0.11, roas: -0.05, confidence: 0.71 },
    },
  ];

  const ct = (id: string, campaignId: string, kind: ContentTarget["kind"], value: string, share: number, efficiency: number, excluded = false): ContentTarget => ({ id, campaignId, kind, value, excluded, share, efficiency });
  const contentTargets: ContentTarget[] = [
    ct("ct1", "c_remarketing", "PLACEMENT", "runnersworld.com", 3, 1.6),
    ct("ct2", "c_remarketing", "PLACEMENT", "strava.com", 2.4, 1.3),
    ct("ct3", "c_remarketing", "PLACEMENT", "mobileapp::com.freegames.puzzle", 4, 0.05),
    ct("ct4", "c_remarketing", "PLACEMENT", "news-aggregator-ar.net", 2.2, 0.2),
    ct("ct5", "c_remarketing", "TOPIC", "Sports & Fitness > Running", 3.5, 1.2),
    ct("ct6", "c_remarketing", "PLACEMENT", "kids-cartoons.example", 0, 0, true),
    ct("ct7", "c_demandgen", "YOUTUBE_CHANNEL", "Global Running TV", 2.6, 1.4),
    ct("ct8", "c_demandgen", "YOUTUBE_CHANNEL", "Arab Fitness Hub", 2.1, 1.1),
    ct("ct9", "c_demandgen", "TOPIC", "Sports & Fitness > Fitness", 3, 0.9),
    ct("ct10", "c_demandgen", "CONTENT_KEYWORD", "marathon training", 1.2, 1.2),
  ];

  const dm = (id: string, campaignId: string, kind: DemographicTarget["kind"], value: string, extra: Partial<DemographicTarget> = {}): DemographicTarget => ({ id, campaignId, kind, value, excluded: false, ...extra });
  const demographics: DemographicTarget[] = [
    ...["18–24", "25–34", "35–44", "45–54", "55–64", "65+", "Unknown"].map((v, i) => dm(`dm_age_${i}`, "c_remarketing", "AGE", v, v === "65+" ? { excluded: true } : v === "25–34" ? { bidModifier: 0.15 } : {})),
    ...["Female", "Male", "Unknown"].map((v, i) => dm(`dm_g_${i}`, "c_remarketing", "GENDER", v)),
    ...["18–24", "25–34", "35–44", "45–54", "55–64", "65+", "Unknown"].map((v, i) => dm(`dm2_age_${i}`, "c_demandgen", "AGE", v, v === "55–64" || v === "65+" ? { excluded: true } : {})),
    ...["Female", "Male", "Unknown"].map((v, i) => dm(`dm2_g_${i}`, "c_demandgen", "GENDER", v)),
  ];

  const links: LinkedAccount[] = [
    { id: "ln_mc", kind: "MERCHANT_CENTER", name: "Stride Store Feed", externalId: "512889034", status: "LINKED" },
    { id: "ln_ga4", kind: "GA4", name: "stride-demo.com – GA4", externalId: "G-8Q2K7LZ1", status: "LINKED" },
    { id: "ln_yt", kind: "YOUTUBE", name: "Stride Running", status: "PENDING" },
    { id: "ln_gbp", kind: "BUSINESS_PROFILE", name: "Stride – Riyadh Park", status: "NOT_LINKED" },
    { id: "ln_gsc", kind: "SEARCH_CONSOLE", name: "stride-demo.com", status: "NOT_LINKED" },
  ];

  const valueRules: ValueRule[] = [
    { id: "vr1", condition: { kind: "AUDIENCE", value: "Customer list – VIP" }, adjustment: 0.3, enabled: true },
    { id: "vr2", condition: { kind: "LOCATION", value: "Riyadh" }, adjustment: 0.1, enabled: false },
  ];

  const offlineImports: OfflineImport[] = [
    { id: "oi1", at: addDays(today, -6) + "T12:00:00Z", fileName: "store-pickups-week41.csv", rows: 184, matched: 151, conversionActionId: "conv_purchase", status: "PROCESSED" },
  ];

  return { products, listingGroups, rules, alerts, scheduledReports, experiments, contentTargets, demographics, links, valueRules, offlineImports };
}

export function emptyExtras(): Extras {
  return {
    products: [],
    listingGroups: [],
    rules: [],
    alerts: [],
    scheduledReports: [],
    experiments: [],
    contentTargets: [],
    demographics: [],
    links: [
      { id: "ln_mc_kw", kind: "MERCHANT_CENTER", name: "Merchant Center", status: "NOT_LINKED" },
      { id: "ln_ga4_kw", kind: "GA4", name: "Google Analytics 4", status: "NOT_LINKED" },
      { id: "ln_yt_kw", kind: "YOUTUBE", name: "YouTube channel", status: "NOT_LINKED" },
      { id: "ln_gbp_kw", kind: "BUSINESS_PROFILE", name: "Business Profile", status: "NOT_LINKED" },
      { id: "ln_gsc_kw", kind: "SEARCH_CONSOLE", name: "Search Console", status: "NOT_LINKED" },
    ],
    valueRules: [],
    offlineImports: [],
  };
}

/** Per-asset ratings Google shows for PMax asset groups. */
export const ASSET_RATINGS: Record<string, AssetRating[]> = {
  asg_all: [
    { kind: "HEADLINE", text: "Shop Stride Sportswear", rating: "GOOD" },
    { kind: "HEADLINE", text: "Free Delivery Over $50", rating: "BEST" },
    { kind: "HEADLINE", text: "Run Cooler This Summer", rating: "BEST" },
    { kind: "HEADLINE", text: "New Season Is Here", rating: "LOW" },
    { kind: "HEADLINE", text: "Easy 30-Day Returns", rating: "GOOD" },
    { kind: "LONG_HEADLINE", text: "Performance shoes and apparel made for Gulf summers", rating: "BEST" },
    { kind: "DESCRIPTION", text: "Shoes, leggings and tops built for heat.", rating: "GOOD" },
    { kind: "DESCRIPTION", text: "Order today, delivered in 1–3 days across KSA & UAE.", rating: "LOW" },
    { kind: "IMAGE", text: "landscape-1", rating: "BEST" },
    { kind: "IMAGE", text: "square-1", rating: "GOOD" },
    { kind: "IMAGE", text: "square-2", rating: "LOW" },
    { kind: "IMAGE", text: "portrait-1", rating: "LEARNING" },
    { kind: "LOGO", text: "logo-square", rating: "GOOD" },
  ],
  asg_running: [
    { kind: "HEADLINE", text: "Running Shoes & Apparel", rating: "GOOD" },
    { kind: "HEADLINE", text: "Light, Cushioned & Fast", rating: "BEST" },
    { kind: "HEADLINE", text: "Free Delivery Over $50", rating: "GOOD" },
    { kind: "DESCRIPTION", text: "Shoes and apparel for road and trail.", rating: "LOW" },
    { kind: "IMAGE", text: "landscape-2", rating: "GOOD" },
    { kind: "IMAGE", text: "square-3", rating: "LEARNING" },
  ],
};

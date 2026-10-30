import type {
  AdStrength,
  AssetType,
  AudienceKind,
  BiddingStrategyType,
  CampaignObjective,
  CampaignType,
  ConversionCategory,
  DateRangePreset,
  MatchType,
  RecommendationCategory,
  ServingIssue,
} from "./types";

/** Google Ads text limits (characters). */
export const LIMITS = {
  headline: 30,
  longHeadline: 90,
  description: 90,
  path: 15,
  rsaHeadlinesMin: 3,
  rsaHeadlinesMax: 15,
  rsaDescriptionsMin: 2,
  rsaDescriptionsMax: 4,
  pmaxHeadlinesMax: 15,
  pmaxLongHeadlinesMax: 5,
  pmaxDescriptionsMax: 5,
  sitelinkText: 25,
  callout: 25,
  keywordText: 80,
  campaignName: 255,
  /** Bid modifiers accept -90% … +900%. */
  bidModifierMin: -0.9,
  bidModifierMax: 9,
} as const;

export const CAMPAIGN_TYPES: Record<
  CampaignType,
  { label: string; short: string; blurb: string; where: string; needs: string; requiresMerchant?: boolean }
> = {
  SEARCH: {
    label: "Search",
    short: "Search",
    blurb: "Text ads on Google search results, triggered by keywords.",
    where: "Google Search, Search partners",
    needs: "Keywords and responsive search ads",
  },
  PERFORMANCE_MAX: {
    label: "Performance Max",
    short: "PMax",
    blurb: "One campaign across every Google channel, optimised by Google AI.",
    where: "Search, YouTube, Display, Discover, Gmail, Maps",
    needs: "Asset groups: text, images, logos, video; optional product feed",
  },
  SHOPPING: {
    label: "Shopping",
    short: "Shopping",
    blurb: "Product listings with image and price, built from your product feed.",
    where: "Shopping tab, Search results",
    needs: "Linked Merchant Center feed",
    requiresMerchant: true,
  },
  DISPLAY: {
    label: "Display",
    short: "Display",
    blurb: "Image ads on millions of sites and apps.",
    where: "Google Display Network",
    needs: "Images, logos and short copy",
  },
  VIDEO: {
    label: "Video",
    short: "Video",
    blurb: "Video ads on YouTube and video partners.",
    where: "YouTube, video partners",
    needs: "A YouTube video",
  },
  DEMAND_GEN: {
    label: "Demand Gen",
    short: "Demand Gen",
    blurb: "Visual, social-style ads that spark interest.",
    where: "YouTube, Discover, Gmail",
    needs: "Images or videos with copy",
  },
};

export const OBJECTIVES: Record<CampaignObjective, { label: string; blurb: string; types: CampaignType[] }> = {
  SALES: {
    label: "Sales",
    blurb: "Drive sales online, in app, by phone or in store",
    types: ["SEARCH", "PERFORMANCE_MAX", "SHOPPING", "DISPLAY", "VIDEO", "DEMAND_GEN"],
  },
  LEADS: {
    label: "Leads",
    blurb: "Get leads and other conversions by encouraging customers to act",
    types: ["SEARCH", "PERFORMANCE_MAX", "DISPLAY", "VIDEO", "DEMAND_GEN"],
  },
  WEBSITE_TRAFFIC: {
    label: "Website traffic",
    blurb: "Get the right people to visit your website",
    types: ["SEARCH", "PERFORMANCE_MAX", "DISPLAY", "DEMAND_GEN"],
  },
  AWARENESS: {
    label: "Awareness and consideration",
    blurb: "Reach a broad audience and build interest in your products",
    types: ["DISPLAY", "VIDEO", "DEMAND_GEN"],
  },
  NONE: {
    label: "Create without a goal",
    blurb: "Choose a campaign type first, without a goal recommendation",
    types: ["SEARCH", "PERFORMANCE_MAX", "SHOPPING", "DISPLAY", "VIDEO", "DEMAND_GEN"],
  },
};

export const BIDDING: Record<BiddingStrategyType, { label: string; focus: string; target?: "CPA" | "ROAS" | "CPC" }> = {
  MAXIMIZE_CONVERSIONS: { label: "Maximize conversions", focus: "Conversions" },
  TARGET_CPA: { label: "Target CPA", focus: "Conversions", target: "CPA" },
  MAXIMIZE_CONVERSION_VALUE: { label: "Maximize conversion value", focus: "Conversion value" },
  TARGET_ROAS: { label: "Target ROAS", focus: "Conversion value", target: "ROAS" },
  MAXIMIZE_CLICKS: { label: "Maximize clicks", focus: "Clicks", target: "CPC" },
  TARGET_IMPRESSION_SHARE: { label: "Target impression share", focus: "Impression share" },
  MANUAL_CPC: { label: "Manual CPC", focus: "Clicks" },
};

/** Which bidding strategies each campaign type accepts. */
export const BIDDING_BY_TYPE: Record<CampaignType, BiddingStrategyType[]> = {
  SEARCH: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS", "MAXIMIZE_CLICKS", "TARGET_IMPRESSION_SHARE", "MANUAL_CPC"],
  PERFORMANCE_MAX: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS"],
  SHOPPING: ["MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS", "MAXIMIZE_CLICKS", "MANUAL_CPC"],
  DISPLAY: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS", "MAXIMIZE_CLICKS", "MANUAL_CPC"],
  VIDEO: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE"],
  DEMAND_GEN: ["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "MAXIMIZE_CONVERSION_VALUE", "TARGET_ROAS", "MAXIMIZE_CLICKS"],
};

export const MATCH_TYPES: Record<MatchType, { label: string; syntax: (t: string) => string; blurb: string }> = {
  BROAD: { label: "Broad match", syntax: (t) => t, blurb: "Searches related in meaning" },
  PHRASE: { label: "Phrase match", syntax: (t) => `"${t}"`, blurb: "Searches that include the meaning" },
  EXACT: { label: "Exact match", syntax: (t) => `[${t}]`, blurb: "Searches with the same meaning" },
};

export const ASSET_TYPES: Record<AssetType, { label: string; blurb: string; levels: ("ACCOUNT" | "CAMPAIGN" | "AD_GROUP")[] }> = {
  SITELINK: { label: "Sitelink", blurb: "Extra links under your ad", levels: ["ACCOUNT", "CAMPAIGN", "AD_GROUP"] },
  CALLOUT: { label: "Callout", blurb: "Short selling points", levels: ["ACCOUNT", "CAMPAIGN", "AD_GROUP"] },
  STRUCTURED_SNIPPET: { label: "Structured snippet", blurb: "A header with a list of values", levels: ["ACCOUNT", "CAMPAIGN", "AD_GROUP"] },
  CALL: { label: "Call", blurb: "A phone number people can tap", levels: ["ACCOUNT", "CAMPAIGN", "AD_GROUP"] },
  IMAGE: { label: "Image", blurb: "Images beside your search ads", levels: ["ACCOUNT", "CAMPAIGN", "AD_GROUP"] },
  PRICE: { label: "Price", blurb: "Products or services with prices", levels: ["ACCOUNT", "CAMPAIGN", "AD_GROUP"] },
  PROMOTION: { label: "Promotion", blurb: "Sales and special offers", levels: ["ACCOUNT", "CAMPAIGN", "AD_GROUP"] },
  LOCATION: { label: "Location", blurb: "Your business address from Business Profile", levels: ["ACCOUNT", "CAMPAIGN"] },
  LEAD_FORM: { label: "Lead form", blurb: "A form people submit inside the ad", levels: ["CAMPAIGN"] },
  BUSINESS_NAME: { label: "Business name", blurb: "Name shown with your ads", levels: ["ACCOUNT", "CAMPAIGN"] },
  BUSINESS_LOGO: { label: "Business logo", blurb: "Logo shown with your ads", levels: ["ACCOUNT", "CAMPAIGN"] },
};

export const SNIPPET_HEADERS = [
  "Amenities",
  "Brands",
  "Courses",
  "Degree programs",
  "Destinations",
  "Featured hotels",
  "Insurance coverage",
  "Models",
  "Neighborhoods",
  "Service catalog",
  "Shows",
  "Styles",
  "Types",
] as const;

export const AUDIENCE_KINDS: Record<AudienceKind, { label: string; blurb: string }> = {
  REMARKETING: { label: "Your data · Website visitors", blurb: "People who visited your store" },
  CUSTOMER_MATCH: { label: "Your data · Customer list", blurb: "Uploaded customer emails and phones" },
  IN_MARKET: { label: "In-market", blurb: "People actively researching to buy" },
  AFFINITY: { label: "Affinity", blurb: "Long-term interests and habits" },
  CUSTOM: { label: "Custom segment", blurb: "Built from keywords, URLs or apps" },
  DEMOGRAPHIC: { label: "Detailed demographics", blurb: "Life stage and household facts" },
};

export const CONVERSION_CATEGORIES: Record<ConversionCategory, string> = {
  PURCHASE: "Purchase",
  ADD_TO_CART: "Add to cart",
  BEGIN_CHECKOUT: "Begin checkout",
  SUBMIT_LEAD_FORM: "Submit lead form",
  SIGNUP: "Sign-up",
  PHONE_CALL_LEAD: "Phone call lead",
  PAGE_VIEW: "Page view",
  CONTACT: "Contact",
};

export const RECOMMENDATION_CATEGORIES: Record<RecommendationCategory, string> = {
  BIDDING_BUDGETS: "Bidding & budgets",
  KEYWORDS_TARGETING: "Keywords & targeting",
  ADS_ASSETS: "Ads & assets",
  MEASUREMENT: "Measurement",
  REPAIRS: "Repairs",
};

export const SERVING_ISSUES: Record<ServingIssue, { label: string; tone: "warn" | "info" | "bad" }> = {
  LIMITED_BY_BUDGET: { label: "Limited by budget", tone: "warn" },
  LEARNING: { label: "Learning", tone: "info" },
  ELIGIBLE_LIMITED: { label: "Eligible (limited)", tone: "warn" },
  PENDING: { label: "Pending", tone: "info" },
  ENDED: { label: "Ended", tone: "bad" },
  NOT_ELIGIBLE: { label: "Not eligible", tone: "bad" },
};

export const AD_STRENGTH: Record<AdStrength, { label: string; score: number; tone: string }> = {
  PENDING: { label: "Pending", score: 0, tone: "text-muted-foreground" },
  POOR: { label: "Poor", score: 1, tone: "text-red-600 dark:text-red-400" },
  AVERAGE: { label: "Average", score: 2, tone: "text-amber-600 dark:text-amber-400" },
  GOOD: { label: "Good", score: 3, tone: "text-sky-600 dark:text-sky-400" },
  EXCELLENT: { label: "Excellent", score: 4, tone: "text-emerald-600 dark:text-emerald-400" },
};

export const DATE_PRESETS: Record<DateRangePreset, { label: string; days: number }> = {
  LAST_7_DAYS: { label: "Last 7 days", days: 7 },
  LAST_14_DAYS: { label: "Last 14 days", days: 14 },
  LAST_30_DAYS: { label: "Last 30 days", days: 30 },
  LAST_90_DAYS: { label: "Last 90 days", days: 90 },
};

/** Locations offered in pickers (mock geo target constants). */
export const GEO_TARGETS = [
  { id: "2682", name: "Saudi Arabia", kind: "Country" as const },
  { id: "2784", name: "United Arab Emirates", kind: "Country" as const },
  { id: "2414", name: "Kuwait", kind: "Country" as const },
  { id: "2634", name: "Qatar", kind: "Country" as const },
  { id: "2048", name: "Bahrain", kind: "Country" as const },
  { id: "2512", name: "Oman", kind: "Country" as const },
  { id: "2818", name: "Egypt", kind: "Country" as const },
  { id: "2400", name: "Jordan", kind: "Country" as const },
  { id: "2422", name: "Lebanon", kind: "Country" as const },
  { id: "2840", name: "United States", kind: "Country" as const },
  { id: "2826", name: "United Kingdom", kind: "Country" as const },
  { id: "2276", name: "Germany", kind: "Country" as const },
  { id: "1012088", name: "Riyadh", kind: "City" as const },
  { id: "1012089", name: "Jeddah", kind: "City" as const },
  { id: "1000002", name: "Dubai", kind: "City" as const },
  { id: "1000001", name: "Abu Dhabi", kind: "City" as const },
  { id: "21354", name: "Makkah Province", kind: "Region" as const },
];

export const LANGUAGES = ["Arabic", "English", "French", "German", "Spanish", "Turkish", "Urdu"];

export const WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

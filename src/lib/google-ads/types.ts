// Google Ads domain model.
//
// Mirrors the Google Ads API resources (customer, campaign, campaign_budget,
// ad_group, ad_group_criterion, ad_group_ad, asset, asset_group, …) so the
// prototype UI can later be fed by the real API without reshaping.
//
// Money is in account-currency units. The API returns micros; the server
// adapter divides by 1e6 at the boundary.

export type EntityStatus = "ENABLED" | "PAUSED" | "REMOVED";

// ─── Account ────────────────────────────────────────────────────────────────

export type GoogleAccount = {
  /** Customer id without dashes, e.g. "1234567890". */
  customerId: string;
  name: string;
  currency: string;
  timeZone: string;
  isManager: boolean;
  /** Manager (MCC) the account is reached through, when any. */
  managerCustomerId?: string;
  /** 0–1, Google's optimization score. */
  optimizationScore: number;
  autoTagging: boolean;
  /** Account has a linked Merchant Center (required for Shopping / feed PMax). */
  merchantCenterId?: string;
  /** Hashed first-party data sent with conversions. */
  enhancedConversions?: boolean;
  /** Content suitability: categories ads never show next to (Display, Video, PMax). */
  excludedContent?: string[];
  /** Account-level brand list kept out of PMax and broad-match traffic. */
  brandExclusions?: string[];
};

// ─── Campaign ───────────────────────────────────────────────────────────────

export type CampaignType =
  | "SEARCH"
  | "PERFORMANCE_MAX"
  | "SHOPPING"
  | "DISPLAY"
  | "VIDEO"
  | "DEMAND_GEN";

export type CampaignObjective = "SALES" | "LEADS" | "WEBSITE_TRAFFIC" | "AWARENESS" | "NONE";

export type BiddingStrategyType =
  | "MAXIMIZE_CONVERSIONS"
  | "MAXIMIZE_CONVERSION_VALUE"
  | "TARGET_CPA"
  | "TARGET_ROAS"
  | "MAXIMIZE_CLICKS"
  | "TARGET_IMPRESSION_SHARE"
  | "MANUAL_CPC";

export type Bidding = {
  type: BiddingStrategyType;
  targetCpa?: number;
  /** Ratio, e.g. 4 = 400%. */
  targetRoas?: number;
  maxCpcLimit?: number;
  /** Portfolio strategy shared across campaigns, when set. */
  portfolioId?: string;
};

export type CampaignBudget = {
  id: string;
  name: string;
  /** Daily amount. */
  amount: number;
  /** Shared budgets serve several campaigns. */
  shared: boolean;
  deliveryMethod: "STANDARD" | "ACCELERATED";
};

export type LocationTarget = {
  id: string;
  name: string;
  kind: "Country" | "Region" | "City";
  excluded?: boolean;
  /** Bid adjustment, -0.9 … +9.0. */
  bidModifier?: number;
};

export type AdScheduleSlot = {
  day: "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
  startHour: number;
  endHour: number;
  bidModifier?: number;
};

export type DeviceModifiers = { mobile: number; desktop: number; tablet: number };

/** Why a campaign isn't serving at full capacity. */
export type ServingIssue =
  | "LIMITED_BY_BUDGET"
  | "LEARNING"
  | "ELIGIBLE_LIMITED"
  | "PENDING"
  | "ENDED"
  | "NOT_ELIGIBLE";

export type Campaign = {
  id: string;
  name: string;
  status: EntityStatus;
  type: CampaignType;
  objective: CampaignObjective;
  budgetId: string;
  bidding: Bidding;
  networks: { googleSearch: boolean; searchPartners: boolean; displayNetwork: boolean };
  locations: LocationTarget[];
  languages: string[];
  schedule: AdScheduleSlot[];
  devices: DeviceModifiers;
  startDate: string;
  endDate?: string;
  conversionActionIds: string[];
  /** Final URL expansion / AI Max for Search. */
  aiMax?: boolean;
  euPoliticalAds: boolean;
  servingIssues: ServingIssue[];
  /** Merchant Center feed, for SHOPPING and feed-based PERFORMANCE_MAX. */
  merchantFeed?: boolean;
  /** PMax: let Google send traffic to other pages on the site. */
  finalUrlExpansion?: boolean;
  labels: string[];
  createdAt: string;
};

// ─── Ad group ───────────────────────────────────────────────────────────────

export type AdGroupType = "SEARCH_STANDARD" | "DISPLAY_STANDARD" | "SHOPPING_PRODUCT_ADS" | "VIDEO" | "DEMAND_GEN";

export type AdGroup = {
  id: string;
  campaignId: string;
  name: string;
  status: EntityStatus;
  type: AdGroupType;
  defaultCpcBid?: number;
  targetCpa?: number;
};

// ─── Keywords ───────────────────────────────────────────────────────────────

export type MatchType = "BROAD" | "PHRASE" | "EXACT";

export type KeywordPolicy = "APPROVED" | "APPROVED_LIMITED" | "DISAPPROVED" | "UNDER_REVIEW";

export type Keyword = {
  id: string;
  adGroupId: string;
  text: string;
  matchType: MatchType;
  status: EntityStatus;
  cpcBid?: number;
  /** 1–10; undefined while Google has too little data. */
  qualityScore?: number;
  qualityParts?: {
    expectedCtr: "ABOVE_AVERAGE" | "AVERAGE" | "BELOW_AVERAGE";
    adRelevance: "ABOVE_AVERAGE" | "AVERAGE" | "BELOW_AVERAGE";
    landingPage: "ABOVE_AVERAGE" | "AVERAGE" | "BELOW_AVERAGE";
  };
  policy: KeywordPolicy;
  finalUrl?: string;
};

export type NegativeKeyword = {
  id: string;
  text: string;
  matchType: MatchType;
  level: "CAMPAIGN" | "AD_GROUP" | "LIST";
  /** Campaign id, ad group id or shared list id, by level. */
  parentId: string;
};

export type NegativeKeywordList = {
  id: string;
  name: string;
  campaignIds: string[];
};

// ─── Ads ────────────────────────────────────────────────────────────────────

export type AdType = "RESPONSIVE_SEARCH_AD" | "RESPONSIVE_DISPLAY_AD" | "VIDEO_AD" | "DEMAND_GEN_AD" | "SHOPPING_PRODUCT_AD";

export type PinPosition = "HEADLINE_1" | "HEADLINE_2" | "HEADLINE_3" | "DESCRIPTION_1" | "DESCRIPTION_2";

export type AdText = { text: string; pinned?: PinPosition };

export type AdStrength = "PENDING" | "POOR" | "AVERAGE" | "GOOD" | "EXCELLENT";

export type AdPolicyStatus = "APPROVED" | "APPROVED_LIMITED" | "DISAPPROVED" | "UNDER_REVIEW";

export type Ad = {
  id: string;
  adGroupId: string;
  type: AdType;
  status: EntityStatus;
  headlines: AdText[];
  descriptions: AdText[];
  /** Responsive display / demand gen only. */
  longHeadline?: string;
  businessName?: string;
  imageUrls?: string[];
  finalUrl: string;
  path1?: string;
  path2?: string;
  adStrength: AdStrength;
  policy: AdPolicyStatus;
  policyTopics?: { topic: string; detail: string }[];
};

// ─── Assets ─────────────────────────────────────────────────────────────────

export type AssetType =
  | "SITELINK"
  | "CALLOUT"
  | "STRUCTURED_SNIPPET"
  | "CALL"
  | "IMAGE"
  | "PRICE"
  | "PROMOTION"
  | "LOCATION"
  | "LEAD_FORM"
  | "BUSINESS_NAME"
  | "BUSINESS_LOGO";

export type AssetLevel = "ACCOUNT" | "CAMPAIGN" | "AD_GROUP";

export type Asset = {
  id: string;
  type: AssetType;
  level: AssetLevel;
  /** Campaign or ad group id; empty for account level. */
  parentId?: string;
  status: EntityStatus;
  policy: AdPolicyStatus;
  /** Human summary, e.g. sitelink text. */
  title: string;
  /** Secondary lines: sitelink descriptions, snippet values, phone number, … */
  lines?: string[];
  finalUrl?: string;
  imageUrl?: string;
};

/** Performance Max replaces ad groups with asset groups. */
export type AssetGroup = {
  id: string;
  campaignId: string;
  name: string;
  status: EntityStatus;
  finalUrl: string;
  headlines: string[];
  longHeadlines: string[];
  descriptions: string[];
  businessName: string;
  imageUrls: string[];
  logoUrls: string[];
  videoUrls: string[];
  /** Hints to Google about who converts; not hard targeting. */
  audienceSignal?: string;
  searchThemes: string[];
  /** Product filters from Merchant Center, e.g. "Brand = Nike". */
  listingGroups: string[];
  adStrength: AdStrength;
  /** Google's per-asset rating, once the group has served enough. */
  assetPerformance?: AssetRating[];
};

export type AssetRating = {
  kind: "HEADLINE" | "LONG_HEADLINE" | "DESCRIPTION" | "IMAGE" | "VIDEO" | "LOGO";
  text: string;
  rating: "BEST" | "GOOD" | "LOW" | "LEARNING";
};

// ─── Shopping: products & product groups ────────────────────────────────────

export type ProductIssue = {
  code: string;
  detail: string;
  severity: "DISAPPROVED" | "LIMITED";
  /** Fixable from catalog data (title, image, GTIN…). */
  fixable: boolean;
};

/** A Merchant Center offer and how it performs in Shopping / PMax. */
export type Product = {
  id: string;
  title: string;
  brand: string;
  productType: string;
  price: number;
  salePrice?: number;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER";
  gtin?: string;
  customLabel0?: string;
  status: "APPROVED" | "LIMITED" | "DISAPPROVED" | "PENDING";
  issues: ProductIssue[];
  /** Share of the account's product-ad traffic and its conversion efficiency. */
  share: number;
  efficiency: number;
  /** Benchmark price from other sellers, when Google has one. */
  benchmarkPrice?: number;
};

export type ListingDimension = "ALL" | "BRAND" | "PRODUCT_TYPE" | "CUSTOM_LABEL_0" | "ITEM_ID" | "OTHERS";

/** Node of a Shopping ad group's product partition tree. */
export type ListingGroup = {
  id: string;
  campaignId: string;
  parentId?: string;
  dimension: ListingDimension;
  value: string;
  /** Max CPC for leaf nodes (manual bidding); ignored with Smart Bidding. */
  bid?: number;
  excluded?: boolean;
};

// ─── Monitoring ─────────────────────────────────────────────────────────────

export type RuleMetric = "cost" | "conversions" | "cpa" | "roas" | "ctr" | "clicks" | "budgetSpent";

export type AutomatedRule = {
  id: string;
  name: string;
  /** Campaign ids, or empty for every enabled campaign. */
  campaignIds: string[];
  condition: { metric: RuleMetric; op: ">" | "<"; value: number; window: "TODAY" | "LAST_7_DAYS" | "LAST_30_DAYS" };
  action: "NOTIFY" | "PAUSE_CAMPAIGN" | "PAUSE_KEYWORDS" | "RAISE_BUDGET" | "LOWER_BUDGET";
  /** Percent for budget actions. */
  amount?: number;
  frequency: "HOURLY" | "DAILY" | "WEEKLY";
  enabled: boolean;
  createdBy: "USER" | "AGENT";
  lastRun?: string;
  lastResult?: string;
};

export type Alert = {
  id: string;
  at: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  campaignId?: string;
  ruleId?: string;
  read: boolean;
  /** Question to hand to the agent from the alert. */
  prompt?: string;
};

export type ScheduledReport = {
  id: string;
  name: string;
  segment: SegmentKey;
  metrics: MetricKey[];
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  recipients: string[];
  format: "PDF" | "CSV" | "EMAIL";
  nextRun: string;
};

export type SegmentKey = "day" | "week" | "dayOfWeek" | "hour" | "device" | "country" | "age" | "gender" | "network" | "campaignType";

// ─── Experiments ────────────────────────────────────────────────────────────

export type Experiment = {
  id: string;
  name: string;
  baseCampaignId: string;
  /** What the trial arm changes, in words, plus the ops it would apply. */
  change: string;
  ops: MutateOp[];
  split: number;
  status: "DRAFT" | "RUNNING" | "ENDED" | "APPLIED";
  startDate: string;
  endDate: string;
  /** Trial vs base, once running. */
  result?: { conversions: number; cpa: number; roas: number; confidence: number };
};

// ─── Display / Video / Demand Gen content targeting ────────────────────────

export type ContentTarget = {
  id: string;
  campaignId: string;
  adGroupId?: string;
  kind: "PLACEMENT" | "YOUTUBE_CHANNEL" | "TOPIC" | "CONTENT_KEYWORD";
  value: string;
  excluded: boolean;
  bidModifier?: number;
  /** Mock performance weight for the placements report. */
  share: number;
  efficiency: number;
};

export type DemographicTarget = {
  id: string;
  campaignId: string;
  kind: "AGE" | "GENDER" | "INCOME" | "PARENTAL";
  value: string;
  excluded: boolean;
  bidModifier?: number;
};

// ─── Linked accounts & conversion extras ───────────────────────────────────

export type LinkedAccount = {
  id: string;
  kind: "GA4" | "MERCHANT_CENTER" | "YOUTUBE" | "BUSINESS_PROFILE" | "SEARCH_CONSOLE";
  name: string;
  externalId?: string;
  status: "LINKED" | "PENDING" | "NOT_LINKED";
};

export type ValueRule = {
  id: string;
  condition: { kind: "LOCATION" | "DEVICE" | "AUDIENCE"; value: string };
  adjustment: number;
  enabled: boolean;
};

export type OfflineImport = {
  id: string;
  at: string;
  fileName: string;
  rows: number;
  matched: number;
  conversionActionId: string;
  status: "PROCESSED" | "PROCESSING" | "FAILED";
};

// ─── Audiences ──────────────────────────────────────────────────────────────

export type AudienceKind = "REMARKETING" | "CUSTOMER_MATCH" | "IN_MARKET" | "AFFINITY" | "CUSTOM" | "DEMOGRAPHIC";

export type AudienceSegment = {
  id: string;
  name: string;
  kind: AudienceKind;
  /** Approximate list size, when known. */
  size?: number;
  description?: string;
  /** How a segment you built is defined, e.g. "Visited /collections/running in 30 days". */
  rule?: string;
  /** Membership duration in days, for your-data segments. */
  durationDays?: number;
};

/** A segment attached to a campaign or ad group. */
export type AudienceTarget = {
  id: string;
  segmentId: string;
  level: "CAMPAIGN" | "AD_GROUP";
  parentId: string;
  /** OBSERVATION reports only; TARGETING restricts reach; EXCLUSION never shows ads to it. */
  mode: "OBSERVATION" | "TARGETING" | "EXCLUSION";
  bidModifier?: number;
};

// ─── Conversions ────────────────────────────────────────────────────────────

export type ConversionCategory =
  | "PURCHASE"
  | "ADD_TO_CART"
  | "BEGIN_CHECKOUT"
  | "SUBMIT_LEAD_FORM"
  | "SIGNUP"
  | "PHONE_CALL_LEAD"
  | "PAGE_VIEW"
  | "CONTACT";

export type ConversionAction = {
  id: string;
  name: string;
  category: ConversionCategory;
  source: "WEBSITE" | "GOOGLE_ANALYTICS" | "IMPORT" | "PHONE_CALLS";
  status: "ACTIVE" | "NO_RECENT_CONVERSIONS" | "UNVERIFIED" | "REMOVED";
  primary: boolean;
  countingType: "ONE_PER_CLICK" | "MANY_PER_CLICK";
  defaultValue?: number;
  useDynamicValue: boolean;
  clickThroughWindowDays: number;
  attribution: "DATA_DRIVEN" | "LAST_CLICK";
  /** Last 30 days. */
  conversions30d: number;
};

// ─── Search terms ───────────────────────────────────────────────────────────

export type SearchTerm = {
  id: string;
  text: string;
  campaignId: string;
  adGroupId: string;
  /** Keyword that matched it. */
  keywordId?: string;
  matchedVia: MatchType | "AI_MAX" | "PMAX";
  status: "NONE" | "ADDED" | "EXCLUDED";
  /** Share of the parent ad group's traffic. */
  share: number;
  /** Conversion efficiency vs the ad group average (1 = average, 0 = never converts). */
  efficiency: number;
};

// ─── Recommendations ────────────────────────────────────────────────────────

export type RecommendationCategory = "BIDDING_BUDGETS" | "KEYWORDS_TARGETING" | "ADS_ASSETS" | "MEASUREMENT" | "REPAIRS";

export type Recommendation = {
  id: string;
  type: string;
  category: RecommendationCategory;
  title: string;
  description: string;
  /** Optimization score uplift, in points (0–100 scale). */
  scoreUplift: number;
  campaignId?: string;
  impact?: string;
  status: "ACTIVE" | "APPLIED" | "DISMISSED";
  /** What applying it does; reused to build the change. */
  ops: MutateOp[];
};

// ─── Metrics ────────────────────────────────────────────────────────────────

export type BaseMetrics = {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
};

export type Metrics = BaseMetrics & {
  ctr: number;
  avgCpc: number;
  convRate: number;
  cpa: number;
  roas: number;
};

export type DailyPoint = BaseMetrics & { date: string; searchImprShare?: number };

export type MetricKey = keyof Metrics;

export type DateRangePreset = "LAST_7_DAYS" | "LAST_14_DAYS" | "LAST_30_DAYS" | "LAST_90_DAYS";

export type DateRange = { preset: DateRangePreset; start: string; end: string };

// ─── Mutations (proposed and applied changes) ──────────────────────────────

/** A campaign with everything it needs, created in one mutate. */
export type CampaignBundle = {
  campaign: Omit<Campaign, "id" | "budgetId" | "createdAt" | "servingIssues" | "labels">;
  budget: Omit<CampaignBudget, "id">;
  adGroups: {
    adGroup: Omit<AdGroup, "id" | "campaignId">;
    keywords: Omit<Keyword, "id" | "adGroupId" | "policy">[];
    ads: Omit<Ad, "id" | "adGroupId" | "policy">[];
  }[];
  assetGroups: Omit<AssetGroup, "id" | "campaignId">[];
  negativeKeywords: Omit<NegativeKeyword, "id" | "level" | "parentId">[];
  assets: Omit<Asset, "id" | "level" | "parentId" | "policy">[];
};

export type MutateOp =
  | { kind: "campaign.create"; bundle: CampaignBundle; tempId: string }
  | { kind: "campaign.update"; campaignId: string; patch: Partial<Omit<Campaign, "id">> }
  | { kind: "campaign.remove"; campaignId: string }
  | { kind: "budget.update"; budgetId: string; amount: number }
  | { kind: "status.set"; entity: "CAMPAIGN" | "AD_GROUP" | "AD" | "KEYWORD" | "ASSET" | "ASSET_GROUP"; ids: string[]; status: EntityStatus }
  | { kind: "adGroup.create"; adGroup: AdGroup; keywords: Keyword[]; ads: Ad[] }
  | { kind: "adGroup.update"; adGroupId: string; patch: Partial<Omit<AdGroup, "id" | "campaignId">> }
  | { kind: "keyword.create"; keywords: Keyword[] }
  | { kind: "keyword.update"; keywordId: string; patch: Partial<Pick<Keyword, "cpcBid" | "matchType" | "finalUrl">> }
  | { kind: "negative.create"; negatives: NegativeKeyword[] }
  | { kind: "negative.remove"; ids: string[] }
  | { kind: "ad.create"; ads: Ad[] }
  | { kind: "ad.update"; adId: string; patch: Partial<Omit<Ad, "id" | "adGroupId">> }
  | { kind: "asset.create"; assets: Asset[] }
  | { kind: "audience.attach"; targets: AudienceTarget[] }
  | { kind: "audience.detach"; ids: string[] }
  | { kind: "conversion.create"; action: ConversionAction }
  | { kind: "conversion.update"; actionId: string; patch: Partial<Omit<ConversionAction, "id">> }
  | { kind: "searchTerm.mark"; ids: string[]; status: SearchTerm["status"] }
  | { kind: "recommendation.set"; ids: string[]; status: Recommendation["status"] }
  | { kind: "account.update"; patch: Partial<Pick<GoogleAccount, "enhancedConversions" | "excludedContent" | "brandExclusions" | "autoTagging" | "merchantCenterId">> }
  | { kind: "assetGroup.update"; assetGroupId: string; patch: Partial<Omit<AssetGroup, "id" | "campaignId">> }
  | CollectionUpsert
  | { kind: "collection.remove"; collection: CollectionKey; ids: string[] };

/** Simple workspace collections that share generic upsert / remove ops. */
export type CollectionKey =
  | "products"
  | "listingGroups"
  | "rules"
  | "alerts"
  | "scheduledReports"
  | "experiments"
  | "contentTargets"
  | "demographics"
  | "links"
  | "valueRules"
  | "offlineImports"
  | "audiences";

export type CollectionUpsert = { [K in CollectionKey]: { kind: "collection.upsert"; collection: K; items: AccountData[K] } }[CollectionKey];

export type DiffRow = {
  /** What is changed, e.g. "Budget · Brand – Search". */
  label: string;
  before?: string;
  after: string;
};

export type ChangeSource = "AGENT" | "USER" | "RECOMMENDATION";

export type ChangeStatus = "PENDING" | "APPLIED" | "REJECTED" | "FAILED";

export type ProposedChange = {
  id: string;
  createdAt: string;
  source: ChangeSource;
  title: string;
  rationale: string;
  /** Short projected effect, e.g. "≈ $340/mo less wasted spend". */
  impact?: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  status: ChangeStatus;
  ops: MutateOp[];
  diff: DiffRow[];
  /** Conversation turn that proposed it. */
  messageId?: string;
  error?: string;
};

export type ChangeEvent = {
  id: string;
  at: string;
  actor: string;
  source: ChangeSource;
  title: string;
  diff: DiffRow[];
  /** Ops that revert this change; absent when it can't be undone. */
  inverse?: MutateOp[];
  undone?: boolean;
  changeId?: string;
};

// ─── Account snapshot ──────────────────────────────────────────────────────

export type AccountData = {
  account: GoogleAccount;
  campaigns: Campaign[];
  budgets: CampaignBudget[];
  adGroups: AdGroup[];
  keywords: Keyword[];
  negatives: NegativeKeyword[];
  negativeLists: NegativeKeywordList[];
  ads: Ad[];
  assets: Asset[];
  assetGroups: AssetGroup[];
  audiences: AudienceSegment[];
  audienceTargets: AudienceTarget[];
  conversions: ConversionAction[];
  searchTerms: SearchTerm[];
  recommendations: Recommendation[];
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
  /** Daily metrics per campaign id. */
  daily: Record<string, DailyPoint[]>;
  /**
   * Share of a parent's traffic per child entity (ad group of campaign, keyword
   * or ad of ad group) and its conversion efficiency. Mock-only; the real API
   * reports child metrics directly.
   */
  weights: Record<string, { share: number; efficiency: number }>;
};

// ─── Agent conversation ────────────────────────────────────────────────────

export type AgentToolStep = {
  /** Tool name as the backend agent would call it, e.g. ads_report. */
  tool: string;
  label: string;
  detail?: string;
};

/** One conversation with the agent. An account can have many, shown as tabs. */
export type ChatThread = {
  id: string;
  title: string;
  messages: AgentMessage[];
  /** "plan": the agent only describes what it would do and proposes nothing. */
  mode: "agent" | "plan";
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  at: string;
  steps?: AgentToolStep[];
  changeIds?: string[];
  /** Quick follow-ups offered under an agent reply. */
  followUps?: string[];
  /** Agent suggests opening this view. */
  viewHint?: GaView;
  /** Reply asks to open the campaign editor prefilled. */
  draftBundle?: CampaignBundle;
  /** Document the turn created or edited. */
  docId?: string;
  docAction?: "created" | "updated";
  docNote?: string;
  /** Plan mode: clarifying questions before the agent starts. */
  questions?: { id: string; label: string; options: string[] }[];
  answered?: boolean;
  /** Specialists working on the turn in parallel. */
  team?: { role: string; task: string; status: "WAITING" | "WORKING" | "DONE" }[];
  /** Visible task list for long jobs. */
  todo?: { label: string; done: boolean }[];
  memoryAdded?: string;
};

export type GaView =
  | "overview"
  | "campaigns"
  | "adGroups"
  | "ads"
  | "assets"
  | "keywords"
  | "negatives"
  | "searchTerms"
  | "audiences"
  | "locations"
  | "schedule"
  | "devices"
  | "recommendations"
  | "conversions"
  | "library"
  | "settings"
  | "pending"
  | "history"
  | "products"
  | "productGroups"
  | "reports"
  | "rules"
  | "keywordPlanner"
  | "experiments"
  | "planner"
  | "content"
  | "demographics"
  | "links"
  | "accountSettings"
  | "documents"
  | "profile"
  | "connections";

/** A Merchant Center account the signed-in Google user can reach (own connection, separate from Google Ads). */
export type MerchantAccount = {
  merchantId: string;
  name: string;
  website: string;
  country: string;
};

export type GaScope = { campaignId?: string; adGroupId?: string };

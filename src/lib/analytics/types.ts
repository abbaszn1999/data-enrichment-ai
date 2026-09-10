export const ANALYTICS_CONNECTION_TYPES = [
  "search-console",
  "google-analytics",
] as const;

export type AnalyticsConnectionType = (typeof ANALYTICS_CONNECTION_TYPES)[number];

export const ANALYTICS_DATE_RANGES = ["7", "28", "90"] as const;
export type AnalyticsDateRange = (typeof ANALYTICS_DATE_RANGES)[number];

export type AnalyticsConnectionPublic = {
  connected: boolean;
  email: string | null;
  property: string | null;
  propertyLabel: string | null;
  needsProperty: boolean;
};

export type AnalyticsStatus = {
  configured: boolean;
  gsc: AnalyticsConnectionPublic;
  ga4: AnalyticsConnectionPublic;
};

export type AnalyticsPropertyOption = {
  id: string;
  label: string;
  detail?: string;
};

export type GscPageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscTimeSeriesRow = {
  date: string;
  clicks: number;
  impressions: number;
};

export type Ga4Overview = {
  users: number;
  sessions: number;
  pageviews: number;
  bounceRate: number;
  avgSessionDuration: number;
};

export type Ga4PageRow = {
  page: string;
  views: number;
  users: number;
  avgDuration: number;
};

export type Ga4TimeSeriesRow = {
  date: string;
  sessions: number;
};

export const ANALYTICS_PAGE_TYPES = ["plp", "products"] as const;
export type AnalyticsPageType = (typeof ANALYTICS_PAGE_TYPES)[number];

export type AnalyticsRulePattern = {
  value: string;
  enabled: boolean;
};

export type AnalyticsRuleConfig = {
  filterMode: "include" | "exclude";
  patternType: "simple" | "regex";
  patterns: {
    logic: "AND" | "OR";
    rules: AnalyticsRulePattern[];
  };
  isActive: boolean;
};

export type AnalyticsRulesRecord = AnalyticsRuleConfig & {
  id: string;
  workspaceId: string;
  pageType: AnalyticsPageType;
};

export type Ga4FilterExpression = {
  filter?: {
    fieldName: string;
    stringFilter: {
      matchType: "CONTAINS" | "PARTIAL_REGEXP";
      value: string;
      caseSensitive: boolean;
    };
  };
  notExpression?: Ga4FilterExpression;
  andGroup?: { expressions: Ga4FilterExpression[] };
  orGroup?: { expressions: Ga4FilterExpression[] };
};

export function isAnalyticsConnectionType(
  value: string
): value is AnalyticsConnectionType {
  return (ANALYTICS_CONNECTION_TYPES as readonly string[]).includes(value);
}

export function isAnalyticsPageType(value: string): value is AnalyticsPageType {
  return (ANALYTICS_PAGE_TYPES as readonly string[]).includes(value);
}

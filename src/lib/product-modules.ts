/**
 * Canonical identifiers for merchant-facing modules.
 * URLs, credit ledger operations, wallet modules, and job labels
 * must import from here rather than restating the strings.
 */
export const CATALOG_INTELLIGENCE = {
  id: "catalog_intelligence",
  label: "Catalog Intelligence",
  table: "catalog_sessions",
  routeSegment: "catalog-intelligence",
  apiBase: "/api/catalog-intelligence",
  creditOperation: "catalog_intelligence",
  jobKind: "catalog",
} as const;

export const STORE_ASSISTANT = {
  id: "store_assistant",
  label: "Store Assistant",
  routeSegment: "store-assistant",
  apiBase: "/api/store-assistant",
  creditOperation: "store_assistant",
  creditEntityType: "store_assistant",
} as const;

export const WALLET_MODULE = {
  marketResearch: "market-research",
  growthSync: "growth-sync",
  websiteRestructure: "website-restructure",
  topup: "topup",
  billing: "Billing",
} as const;

export function catalogIntelligencePath(
  slug: string,
  sessionId?: string,
  step?: "new" | "rules" | "review"
): string {
  const base = `/w/${slug}/${CATALOG_INTELLIGENCE.routeSegment}`;
  if (step === "new") return `${base}/new`;
  if (!sessionId) return base;
  if (step === "rules" || step === "review") return `${base}/${sessionId}/${step}`;
  return `${base}/${sessionId}`;
}

export function storeAssistantPath(slug: string): string {
  return `/w/${slug}/${STORE_ASSISTANT.routeSegment}`;
}

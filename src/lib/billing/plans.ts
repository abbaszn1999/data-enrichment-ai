/**
 * Canonical OS billing catalog. Source of truth: https://autommerce.com/pricing
 *
 * Growth and Pro are self-serve Stripe subscriptions.
 * Enterprise is display-only — CTA leaves the app for the marketing contact form.
 * Starter is no longer sold; existing rows stay for grandfathered subscribers.
 */

export const ENTERPRISE_CONTACT_URL =
  "https://autommerce.com/contact?plan=enterprise" as const;

export const OS_PRODUCTS = [
  "Product Enrichment",
  "Ranking Engine",
  "Product Visualizer",
  "Product Gallery",
  "Image Classification",
  "Store Assistant",
] as const;

export type PaidPlanName = "growth" | "pro" | "enterprise";
export type PlanName = "trial" | "starter" | PaidPlanName;
export type CheckoutKind = "stripe" | "contact" | "none";

export type CanonicalPlan = {
  name: PaidPlanName | "starter" | "trial";
  displayName: string;
  description: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  monthlyCredits: number | null;
  maxWorkspaces: number | null;
  maxMembers: number | null;
  maxProducts: number | null;
  maxImports: number | null;
  support: string;
  onboarding: string;
  checkout: CheckoutKind;
  extras: string[];
};

/** Live Stripe catalog on platform.autommerce.com. Enterprise has no Stripe product. */
export const LIVE_STRIPE_CATALOG = {
  growth: {
    productId: "prod_UGefao448fl34O",
    priceMonthlyId: "price_1TI7MSPfGzfuCByPq7Mncsxo",
    priceYearlyId: "price_1TI7MsPfGzfuCByPWBTfbD0j",
  },
  pro: {
    productId: "prod_UGegjkopEzfRzx",
    priceMonthlyId: "price_1TI7NPPfGzfuCByPiGDzRbPS",
    priceYearlyId: "price_1TI7NiPfGzfuCByPN2Bz9ybC",
  },
} as const;

export const PUBLIC_CATALOG_ORDER = ["growth", "pro", "enterprise"] as const;

export const PLAN_CATALOG: Record<PaidPlanName, CanonicalPlan> = {
  growth: {
    name: "growth",
    displayName: "Growth",
    description:
      "For growing ecommerce teams. Same OS product as Pro — more capacity, seats, and support.",
    priceMonthly: 1500,
    priceYearly: 1200,
    monthlyCredits: 3200,
    maxWorkspaces: 2,
    maxMembers: 10,
    maxProducts: null,
    maxImports: null,
    support: "Priority · 8h",
    onboarding: "Dedicated",
    checkout: "stripe",
    extras: [],
  },
  pro: {
    name: "pro",
    displayName: "Pro",
    description:
      "For larger retail operations. Same OS product as Growth — higher capacity, seats, and white-glove support.",
    priceMonthly: 2500,
    priceYearly: 2000,
    monthlyCredits: 7000,
    maxWorkspaces: 5,
    maxMembers: 20,
    maxProducts: null,
    maxImports: null,
    support: "Slack · 2h",
    onboarding: "White-glove",
    checkout: "stripe",
    extras: [],
  },
  enterprise: {
    name: "enterprise",
    displayName: "Enterprise",
    description:
      "Custom pool, seats, and SLA. Same OS product, sized to your catalog after a quote.",
    priceMonthly: null,
    priceYearly: null,
    monthlyCredits: null,
    maxWorkspaces: null,
    maxMembers: null,
    maxProducts: null,
    maxImports: null,
    support: "Dedicated SLA",
    onboarding: "White-glove",
    checkout: "contact",
    extras: [
      "Dedicated success and operating SLA",
      "Security, SSO, and procurement review",
      "Architecture and rollout plan",
    ],
  },
};

export type PublicCheckoutPlan = {
  id: string;
  name: PaidPlanName;
  display_name: string;
  description: string;
  monthly_ai_credits: number | null;
  price_monthly: number | null;
  price_yearly: number | null;
  max_workspaces: number | null;
  max_members_per_workspace: number | null;
  max_products_per_workspace: number | null;
  max_imports_per_month: number | null;
  stripe_product_id: string | null;
  stripe_price_monthly_id: string | null;
  stripe_price_yearly_id: string | null;
  is_active: boolean;
  checkout: CheckoutKind;
  support: string;
  onboarding: string;
  extras: string[];
  products: readonly string[];
};

type PlanRow = {
  id?: string;
  name?: string;
  stripe_product_id?: string | null;
  stripe_price_monthly_id?: string | null;
  stripe_price_yearly_id?: string | null;
};

export function isSelfServePlanName(name: string | null | undefined): boolean {
  return name === "growth" || name === "pro";
}

export function isGrandfatheredPlanName(name: string | null | undefined): boolean {
  return name === "starter";
}

export function isContactPlanName(name: string | null | undefined): boolean {
  return name === "enterprise";
}

export function isPublicCatalogPlanName(name: string | null | undefined): name is PaidPlanName {
  return name === "growth" || name === "pro" || name === "enterprise";
}

export function checkoutBlockedReason(
  plan: {
    name?: string | null;
    stripe_price_monthly_id?: string | null;
    stripe_price_yearly_id?: string | null;
  } | null,
  billingCycle: string
): string | null {
  const name = plan?.name ?? "";
  if (!plan || name === "trial") return "This plan cannot be purchased";
  if (isGrandfatheredPlanName(name)) {
    return "Starter is no longer offered. Choose Growth or Pro, or contact sales to migrate.";
  }
  if (isContactPlanName(name)) {
    return "Enterprise is quote-only. Open the contact form to get a quote.";
  }
  if (!isSelfServePlanName(name)) return "This plan cannot be purchased";
  const priceId =
    billingCycle === "yearly" ? plan.stripe_price_yearly_id : plan.stripe_price_monthly_id;
  if (!priceId) return "Stripe price not configured for this plan";
  return null;
}

export function buildPublicCheckoutPlans(rows: PlanRow[] | null | undefined): PublicCheckoutPlan[] {
  const byName = new Map((rows ?? []).map((row) => [row.name, row]));
  return PUBLIC_CATALOG_ORDER.map((name) => {
    const canonical = PLAN_CATALOG[name];
    const row = byName.get(name) ?? {};
    return {
      id: row.id ?? `catalog:${name}`,
      name: canonical.name as PaidPlanName,
      display_name: canonical.displayName,
      description: canonical.description,
      monthly_ai_credits: canonical.monthlyCredits,
      price_monthly: canonical.priceMonthly,
      price_yearly: canonical.priceYearly,
      max_workspaces: canonical.maxWorkspaces,
      max_members_per_workspace: canonical.maxMembers,
      max_products_per_workspace: canonical.maxProducts,
      max_imports_per_month: canonical.maxImports,
      stripe_product_id: row.stripe_product_id ?? null,
      stripe_price_monthly_id: row.stripe_price_monthly_id ?? null,
      stripe_price_yearly_id: row.stripe_price_yearly_id ?? null,
      is_active: true,
      checkout: canonical.checkout,
      support: canonical.support,
      onboarding: canonical.onboarding,
      extras: canonical.extras,
      products: OS_PRODUCTS,
    };
  });
}

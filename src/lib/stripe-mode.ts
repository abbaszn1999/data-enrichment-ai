export type StripeKeyMode = "live" | "test" | "unset";

const DEV_LIVE_KEY_ERROR =
  "Live Stripe keys are blocked in development. Add sk_test_ keys to .env.local so local billing cannot charge production.";

const PROD_TEST_KEY_ERROR = "Test Stripe keys cannot be used in production.";

const UNSET_DEV_ERROR =
  "Stripe is not configured for local development. Add TEST keys (sk_test_ / pk_test_) to .env.local, then run npm run stripe:setup-test.";

export function getStripeKeyMode(): StripeKeyMode {
  const secret = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (secret.startsWith("sk_live_")) return "live";
  if (secret.startsWith("sk_test_")) return "test";
  return "unset";
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Throws if the current Stripe secret is unsafe for this runtime. */
export function assertStripeKeyAllowed(): void {
  const mode = getStripeKeyMode();
  const prod = isProductionRuntime();
  if (!prod && mode === "live") {
    throw new Error(DEV_LIVE_KEY_ERROR);
  }
  if (prod && mode === "test") {
    throw new Error(PROD_TEST_KEY_ERROR);
  }
}

export function stripeCheckoutBlockedReason(): string | null {
  const mode = getStripeKeyMode();
  const prod = isProductionRuntime();
  if (!prod && mode === "live") return DEV_LIVE_KEY_ERROR;
  if (!prod && mode === "unset") return UNSET_DEV_ERROR;
  if (prod && mode === "test") return PROD_TEST_KEY_ERROR;
  if (mode === "unset") return "STRIPE_SECRET_KEY is not set";
  return null;
}

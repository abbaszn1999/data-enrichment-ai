/**
 * Autommerce brand foundation.
 *
 * Keep raw identity values here; product features should import semantic
 * aliases instead of duplicating hex values. The dashboard is the first
 * surface adopting this system. Other tools migrate one at a time.
 */
export const AUTOMMERCE_COLORS = {
  primary: {
    orange: "#F76D01",
    red: "#C40000",
    purple: "#400095",
  },
  secondary: {
    violet: "#6B358D",
    lavender: "#C8A8D2",
    burgundy: "#79081D",
  },
  neutral: {
    ink: "#171717",
    paper: "#FFFFFF",
  },
} as const;

export const AUTOMMERCE_GRADIENTS = {
  signature:
    "linear-gradient(135deg, #F76D01 0%, #C40000 48%, #400095 100%)",
  warm: "linear-gradient(135deg, #F76D01 0%, #C40000 100%)",
  royal: "linear-gradient(135deg, #6B358D 0%, #400095 100%)",
  deep: "linear-gradient(135deg, #400095 0%, #79081D 100%)",
} as const;

export const AUTOMMERCE_TYPOGRAPHY = {
  /**
   * Uni Neue is licensed by Fontfabric for web embedding. Until licensed
   * WOFF2 files are supplied, this stack deliberately falls back to Geist
   * rather than downloading an unlicensed copy.
   */
  family:
    '"Uni Neue", var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
  displayWeight: 900,
  headingWeight: 800,
  bodyWeight: 400,
} as const;

export const AUTOMMERCE_LOGOS = {
  light: "/autommerce-natural.png",
  dark: "/autommerce-white.png",
} as const;

/** Canonical product identity. Import these; do not restating the name as a JSX literal. */
export const PRODUCT_NAME = "Autommerce";
export const PRODUCT_FULL_NAME = "Autommerce Platform";
export const PRODUCT_TAGLINE = "AI Commerce Operations";
export const PRODUCT_ORIGIN = "https://platform.autommerce.com";
export const CRAWLER_USER_AGENT =
  "Mozilla/5.0 (compatible; AutommerceBot/1.0; +https://platform.autommerce.com/bot)";


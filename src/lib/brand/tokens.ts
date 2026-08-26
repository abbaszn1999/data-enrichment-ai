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


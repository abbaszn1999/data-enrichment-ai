// Merchant Center connection helpers. The connection is ours (own Google
// consent, own account); the *link* is a setting inside Google Ads that ties an
// ad account to a Merchant Center account. Shopping and feed-based Performance
// Max only work when both exist and point at each other.

/**
 * - LINKED: the ad account is linked to this Merchant Center account.
 * - OTHER: the ad account is linked to a different Merchant Center account.
 * - NONE: the ad account has no Merchant Center link yet.
 */
export type MerchantLink = "LINKED" | "OTHER" | "NONE";

export function merchantLinkState(adsMerchantId: string | undefined, merchantId: string): MerchantLink {
  if (!adsMerchantId) return "NONE";
  return adsMerchantId === merchantId ? "LINKED" : "OTHER";
}

export const MERCHANT_SCOPE = "https://www.googleapis.com/auth/content";

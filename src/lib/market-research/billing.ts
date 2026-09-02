"use client";

/**
 * Client helpers kept for Market Research receipts. Charges themselves run
 * inside the API routes so Apify cannot start without a successful hold.
 */

export const MARKET_RESEARCH_WALLET_MODULE = "market-research";

export type MrChargeKind =
  | "apify_seed_probe"
  | "apify_keyword_extract"
  | "collection_push";

export function makeMrIdempotencyKey(
  kind: MrChargeKind,
  parts: Array<string | number | undefined>
): string {
  return [kind, ...parts.map((part) => String(part ?? ""))].join(":");
}

export async function previewBalance(workspaceId: string): Promise<number> {
  if (!workspaceId) return 0;
  const response = await fetch(
    `/api/wallet?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!response.ok) return 0;
  const data = (await response.json().catch(() => ({}))) as {
    wallet?: { balance?: number };
  };
  return Number(data.wallet?.balance ?? 0);
}

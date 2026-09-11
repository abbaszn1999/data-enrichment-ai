"use client";

/**
 * Client helpers for Free Assessment receipts. Charges themselves run inside
 * the API routes so Apify cannot start without a successful hold. Balance is
 * read from the FA wallet, never the Growth Engine wallet.
 */

export const FREE_ASSESSMENT_WALLET_MODULE = "free-assessment";

export type FaChargeKind = "apify_seed_probe" | "apify_keyword_extract";

export function makeFaIdempotencyKey(
  kind: FaChargeKind,
  parts: Array<string | number | undefined>
): string {
  return ["fa", kind, ...parts.map((part) => String(part ?? ""))].join(":");
}

export async function previewBalance(workspaceId: string): Promise<number> {
  if (!workspaceId) return 0;
  const response = await fetch(
    `/api/free-assessment/wallet?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!response.ok) return 0;
  const data = (await response.json().catch(() => ({}))) as {
    wallet?: { balance?: number };
  };
  return Number(data.wallet?.balance ?? 0);
}

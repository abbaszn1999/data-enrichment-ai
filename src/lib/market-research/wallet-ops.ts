import type { SupabaseClient } from "@supabase/supabase-js";
import { actualExtractCostUsd, roundUsd } from "./cost";
import { chargeWorkspaceWallet, creditWorkspaceWallet } from "@/lib/wallet/server";

export const MARKET_RESEARCH_WALLET_MODULE = "Market Research";

type ExtractRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  held_usd: number | string;
  actual_usd: number | string;
  rows_returned: number;
  billing_status: string;
  status: string;
};

export async function chargeMrWallet(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    amountUsd: number;
    description: string;
    idempotencyKey: string;
    details?: Record<string, unknown>;
  }
) {
  return chargeWorkspaceWallet(admin, {
    ...input,
    module: MARKET_RESEARCH_WALLET_MODULE,
  });
}

export async function refundMrWallet(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    amountUsd: number;
    description: string;
    idempotencyKey: string;
    details?: Record<string, unknown>;
  }
) {
  return creditWorkspaceWallet(admin, {
    ...input,
    kind: "refund",
    module: MARKET_RESEARCH_WALLET_MODULE,
  });
}

export async function settleExtractBilling(
  admin: SupabaseClient,
  input: {
    extract: ExtractRow;
    userId: string;
    rowsReturned: number;
    status: "succeeded" | "failed" | "aborted";
  }
) {
  const held = roundUsd(Number(input.extract.held_usd) || 0);
  const actual = actualExtractCostUsd(input.rowsReturned);
  const refund = roundUsd(Math.max(0, held - actual));
  const extra = roundUsd(Math.max(0, actual - held));

  if (refund > 0) {
    const credited = await refundMrWallet(admin, {
      workspaceId: input.extract.workspace_id,
      userId: input.userId,
      amountUsd: refund,
      description: `Extract settlement refund · ${input.rowsReturned.toLocaleString("en-US")} rows`,
      idempotencyKey: `apify_keyword_extract:refund:${input.extract.id}`,
      details: { extractId: input.extract.id, rowsReturned: input.rowsReturned },
    });
    if (!credited.ok) {
      return { actualUsd: actual, heldUsd: held, refundUsd: refund, pending: "refund" as const };
    }
  }
  if (extra > 0) {
    const charged = await chargeMrWallet(admin, {
      workspaceId: input.extract.workspace_id,
      userId: input.userId,
      amountUsd: extra,
      description: `Extract settlement extra · ${input.rowsReturned.toLocaleString("en-US")} rows`,
      idempotencyKey: `apify_keyword_extract:extra:${input.extract.id}`,
      details: { extractId: input.extract.id, rowsReturned: input.rowsReturned },
    });
    if (!charged.ok) {
      return { actualUsd: actual, heldUsd: held, refundUsd: refund, pending: "extra" as const };
    }
  }

  const billingStatus =
    input.status === "succeeded" || input.rowsReturned > 0
      ? "settled"
      : "refunded";

  const { data: claimed } = await admin
    .from("mr_extracts")
    .update({
      status: input.status,
      rows_returned: input.rowsReturned,
      actual_usd: actual,
      billing_status: billingStatus,
    })
    .eq("id", input.extract.id)
    .eq("billing_status", "held")
    .select("id")
    .maybeSingle();

  if (claimed) {
    await admin
      .from("mr_projects")
      .update({
        extract_rows: input.rowsReturned,
        extract_charged_usd: actual,
      })
      .eq("id", input.extract.project_id);
  }

  return { actualUsd: actual, heldUsd: held, refundUsd: refund };
}

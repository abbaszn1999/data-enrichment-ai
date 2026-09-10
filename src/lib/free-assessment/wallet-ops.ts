import type { SupabaseClient } from "@supabase/supabase-js";
import { actualExtractCostUsd, roundUsd } from "./cost";
import { chargeFaWallet, creditFaWallet } from "./wallet-server";

/** Every Free Assessment charge lands on the FA wallet, never workspace_wallets. */
export const FREE_ASSESSMENT_WALLET_MODULE = "free-assessment";

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

export async function chargeAssessmentWallet(
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
  return chargeFaWallet(admin, {
    ...input,
    module: FREE_ASSESSMENT_WALLET_MODULE,
  });
}

export async function refundAssessmentWallet(
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
  return creditFaWallet(admin, {
    ...input,
    kind: "refund",
    module: FREE_ASSESSMENT_WALLET_MODULE,
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
    const credited = await refundAssessmentWallet(admin, {
      workspaceId: input.extract.workspace_id,
      userId: input.userId,
      amountUsd: refund,
      description: `Extract settlement refund · ${input.rowsReturned.toLocaleString("en-US")} rows`,
      idempotencyKey: `fa_keyword_extract:refund:${input.extract.id}`,
      details: { extractId: input.extract.id, rowsReturned: input.rowsReturned },
    });
    if (!credited.ok) {
      return { actualUsd: actual, heldUsd: held, refundUsd: refund, pending: "refund" as const };
    }
  }
  if (extra > 0) {
    const charged = await chargeAssessmentWallet(admin, {
      workspaceId: input.extract.workspace_id,
      userId: input.userId,
      amountUsd: extra,
      description: `Extract settlement extra · ${input.rowsReturned.toLocaleString("en-US")} rows`,
      idempotencyKey: `fa_keyword_extract:extra:${input.extract.id}`,
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
    .from("fa_extracts")
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
      .from("fa_projects")
      .update({
        extract_rows: input.rowsReturned,
        extract_charged_usd: actual,
      })
      .eq("id", input.extract.project_id);
  }

  return { actualUsd: actual, heldUsd: held, refundUsd: refund };
}

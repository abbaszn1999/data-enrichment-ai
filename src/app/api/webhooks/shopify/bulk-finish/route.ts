// Shopify BULK_OPERATIONS_FINISH webhook handler.
//
// Shopify POSTs here when a bulk query or mutation completes. We verify the
// HMAC signature, then upsert the bulk operation state into
// public.sync_bulk_operations for the agent + UI to observe via polling.
//
// Verified shape: https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic#BULK_OPERATIONS_FINISH

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase-admin";

export const maxDuration = 60;

function verifyShopifyHmac(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(hmacHeader, "utf8")
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const shopDomain = request.headers.get("x-shopify-shop-domain");
  const topic = request.headers.get("x-shopify-topic");

  // Secret must match the one used on webhookSubscriptionCreate.
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_API_SECRET || "";
  if (secret) {
    if (!verifyShopifyHmac(rawBody, hmac, secret)) {
      return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
    }
  } else {
    console.warn("[bulk-finish] SHOPIFY_WEBHOOK_SECRET not set; skipping HMAC verification");
  }

  if (topic && topic !== "bulk_operations/finish") {
    return NextResponse.json({ error: "Unexpected topic" }, { status: 400 });
  }

  let payload: {
    admin_graphql_api_id?: string;
    status?: string;
    error_code?: string | null;
    type?: string;
    completed_at?: string | null;
    object_count?: number | null;
    file_size?: number | null;
    url?: string | null;
    partial_data_url?: string | null;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bulkId = payload.admin_graphql_api_id;
  if (!bulkId) {
    return NextResponse.json({ error: "Missing admin_graphql_api_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Update existing bulk op row keyed by shopify_bulk_id. If it doesn't exist
  // yet (webhook beat our insert), create a placeholder and let future queries
  // reconcile using shopify_bulk_id.
  const update = {
    status: (payload.status ?? "completed").toLowerCase(),
    object_count: payload.object_count ?? null,
    file_size: payload.file_size ?? null,
    url: payload.url ?? null,
    partial_data_url: payload.partial_data_url ?? null,
    error_code: payload.error_code ?? null,
    completed_at: payload.completed_at ?? new Date().toISOString(),
  };

  const { data: existing } = await admin
    .from("sync_bulk_operations")
    .select("id")
    .eq("shopify_bulk_id", bulkId)
    .maybeSingle();

  if (existing) {
    await admin.from("sync_bulk_operations").update(update).eq("shopify_bulk_id", bulkId);
  } else {
    // Placeholder: we may not know the workspace yet; we match against domain when we do.
    // Safest approach: look up the subscription via shop_domain → workspace, otherwise skip.
    if (shopDomain) {
      const { data: sub } = await admin
        .from("shopify_webhook_registrations")
        .select("workspace_id")
        .ilike("callback_url", `%${shopDomain}%`)
        .maybeSingle();
      if (sub?.workspace_id) {
        await admin.from("sync_bulk_operations").insert({
          workspace_id: sub.workspace_id,
          kind: payload.type?.toLowerCase() === "mutation" ? "mutation" : "query",
          shopify_bulk_id: bulkId,
          ...update,
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

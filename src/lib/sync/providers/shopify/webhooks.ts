// Shopify webhook auto-registration.
//
// Ensures that the BULK_OPERATIONS_FINISH webhook is registered for a given
// shop, idempotently. Persists registration in `public.shopify_webhook_registrations`
// so we don't re-create it on every bulk_query call.
//
// Refs:
//   https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/webhookSubscriptionCreate

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationRecord } from "@/lib/sync/core/types";
import { shopifyGraphQL } from "./graphql-client";

const WEBHOOK_SUBSCRIPTION_CREATE = /* GraphQL */ `
  mutation WebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id callbackUrl }
      userErrors { field message }
    }
  }
`;

const TOPIC_BULK_OPERATIONS_FINISH = "BULK_OPERATIONS_FINISH";

function buildCallbackUrl(): string | null {
  const base =
    process.env.SHOPIFY_WEBHOOK_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.URL || // Netlify default
    null;
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/api/webhooks/shopify/bulk-finish`;
}

/**
 * Idempotently ensures the BULK_OPERATIONS_FINISH webhook is registered for the
 * shop owned by `workspaceId`. Safe to call before every bulk_query — it short-
 * circuits if a row already exists.
 *
 * Returns true on success (registered or already present), false on hard failure
 * (logged but never throws — bulk_query should still proceed).
 */
export async function ensureBulkFinishWebhook(params: {
  admin: SupabaseClient;
  workspaceId: string;
  integration: IntegrationRecord;
}): Promise<boolean> {
  try {
    const { data: existing } = await params.admin
      .from("shopify_webhook_registrations")
      .select("id")
      .eq("workspace_id", params.workspaceId)
      .eq("topic", TOPIC_BULK_OPERATIONS_FINISH)
      .maybeSingle();
    if (existing) return true;

    const callbackUrl = buildCallbackUrl();
    if (!callbackUrl) {
      console.warn(
        "[webhooks] Cannot register BULK_OPERATIONS_FINISH: no public base URL set " +
          "(SHOPIFY_WEBHOOK_BASE_URL / NEXT_PUBLIC_SITE_URL / URL)."
      );
      return false;
    }

    const res = await shopifyGraphQL<{
      webhookSubscriptionCreate: {
        webhookSubscription: { id: string; callbackUrl: string } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>({
      integration: params.integration,
      query: WEBHOOK_SUBSCRIPTION_CREATE,
      variables: {
        topic: TOPIC_BULK_OPERATIONS_FINISH,
        webhookSubscription: { callbackUrl, format: "JSON" },
      },
      options: { estimatedCost: 10, tag: "webhookSubscriptionCreate" },
    });

    if (res.errors.length > 0) {
      console.warn(`[webhooks] webhookSubscriptionCreate failed: ${res.errors[0].message}`);
      return false;
    }
    const payload = res.data?.webhookSubscriptionCreate;
    if (!payload) return false;
    if (payload.userErrors.length > 0) {
      // Shopify returns "for this topic and address has already been taken" if
      // the subscription already exists on the shop side. Treat as success and
      // just persist the registration row so we skip in future.
      const alreadyExists = payload.userErrors.some((e) =>
        /already.*taken|already.*subscribed|already.*exist/i.test(e.message)
      );
      if (!alreadyExists) {
        console.warn(
          `[webhooks] webhookSubscriptionCreate userError: ${payload.userErrors[0].message}`
        );
        return false;
      }
    }

    const subId = payload.webhookSubscription?.id ?? "(existing)";
    const { error: insertError } = await params.admin
      .from("shopify_webhook_registrations")
      .upsert(
        {
          workspace_id: params.workspaceId,
          topic: TOPIC_BULK_OPERATIONS_FINISH,
          shopify_subscription_id: subId,
          callback_url: callbackUrl,
        },
        { onConflict: "workspace_id,topic" }
      );
    if (insertError) {
      console.warn(`[webhooks] persist registration failed: ${insertError.message}`);
      // Still return true — webhook is live on Shopify side.
    }
    return true;
  } catch (err) {
    console.warn(
      `[webhooks] ensureBulkFinishWebhook unexpected error: ${(err as Error).message}`
    );
    return false;
  }
}

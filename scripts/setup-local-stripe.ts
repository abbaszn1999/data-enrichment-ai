/**
 * Creates Stripe TEST products/prices for the local Supabase project and
 * writes those IDs onto public.subscription_plans.
 *
 * Requires .env.local:
 *   STRIPE_SECRET_KEY=sk_test_...
 *   NEXT_PUBLIC_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Usage: npm run stripe:setup-test
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";

function loadEnvFiles() {
  const root = process.cwd();
  const env: Record<string, string> = {};
  for (const file of [".env", ".env.local"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  return env;
}

async function main() {
  const env = loadEnvFiles();
  const secret = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (!secret.startsWith("sk_test_")) {
    console.error(
      "stripe:setup-test needs a TEST secret in .env.local (sk_test_...).\n" +
        "Copy it from https://dashboard.stripe.com/test/apikeys — never use sk_live_ here."
    );
    process.exit(1);
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl?.includes("bbgsbvibuhoyoeolgiuh") && !supabaseUrl?.includes("127.0.0.1") && !supabaseUrl?.includes("localhost")) {
    console.error(
      "Refusing to write Stripe test prices: NEXT_PUBLIC_SUPABASE_URL is not the local project."
    );
    process.exit(1);
  }
  if (!serviceKey) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is missing from .env.local");
    process.exit(1);
  }

  const stripe = new Stripe(secret);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: plans, error } = await admin
    .from("subscription_plans")
    .select("id, name, display_name, price_monthly, price_yearly")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error || !plans?.length) {
    console.error("Could not load subscription_plans:", error?.message ?? "none found");
    process.exit(1);
  }

  for (const plan of plans) {
    const productName = `Autommerce ${plan.display_name} (local test)`;
    const lookupBase = `autommerce_local_${plan.name}`;

    let product = (
      await stripe.products.search({
        query: `metadata['local_plan']:'${plan.name}'`,
        limit: 1,
      }).catch(async () => {
        const listed = await stripe.products.list({ limit: 100 });
        return { data: listed.data.filter((p) => p.metadata?.local_plan === plan.name) };
      })
    ).data[0];

    if (!product) {
      product = await stripe.products.create({
        name: productName,
        metadata: { local_plan: plan.name, plan_id: plan.id },
      });
    }

    const monthlyAmount = Math.round(Number(plan.price_monthly ?? 0) * 100);
    const yearlyAmount = Math.round(Number(plan.price_yearly ?? 0) * 100);

    const monthly = await ensurePrice(stripe, product.id, `${lookupBase}_month`, "month", monthlyAmount);
    const yearly = await ensurePrice(stripe, product.id, `${lookupBase}_year`, "year", yearlyAmount);

    const { error: updateError } = await admin
      .from("subscription_plans")
      .update({
        stripe_product_id: product.id,
        stripe_price_monthly_id: monthly.id,
        stripe_price_yearly_id: yearly.id,
      })
      .eq("id", plan.id);

    if (updateError) {
      console.error(`Failed to update ${plan.name}:`, updateError.message);
      process.exit(1);
    }

    console.log(`${plan.name}: product ${product.id}`);
    console.log(`  monthly ${monthly.id}  yearly ${yearly.id}`);
  }

  console.log("\nLocal subscription_plans now point at Stripe TEST prices.");
  console.log("Forward webhooks with: npm run stripe:listen");
  console.log("Paste the whsec_... that command prints into STRIPE_WEBHOOK_SECRET in .env.local, then restart npm run dev.");
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  lookupKey: string,
  interval: "month" | "year",
  unitAmount: number
) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existing.data[0]) return existing.data[0];
  return stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: Math.max(unitAmount, 0),
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: { local: "1" },
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

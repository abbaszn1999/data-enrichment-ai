/**
 * Archive the live Starter Stripe product and prices so they cannot be used
 * for new Checkout or portal switches. Does not cancel any subscriptions.
 *
 * Usage: node scripts/archive-starter-stripe.mjs
 */
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";

function loadEnv() {
  const env = {};
  for (const file of [".env", ".env.local"]) {
    const full = path.join(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t
        .slice(i + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (env[k] == null) env[k] = v;
    }
  }
  return env;
}

const STARTER_PRODUCT = "prod_UGecoPJRbOI2ol";
const STARTER_PRICES = ["price_1TI7JNPfGzfuCByPAKWc9Mmj", "price_1TI7L6PfGzfuCByPox0ILPm3"];

const env = loadEnv();
const key = (env.STRIPE_SECRET_KEY || "").trim();
if (!key.startsWith("sk_live_")) {
  console.error("Refusing to archive: STRIPE_SECRET_KEY is not a live key.");
  process.exit(1);
}

const stripe = new Stripe(key);

const product = await stripe.products.update(STARTER_PRODUCT, { active: false });
console.log(`archived product ${product.id} (${product.name})`);

for (const id of STARTER_PRICES) {
  const price = await stripe.prices.update(id, { active: false });
  console.log(`archived price ${price.id} (${price.unit_amount} ${price.recurring?.interval})`);
}

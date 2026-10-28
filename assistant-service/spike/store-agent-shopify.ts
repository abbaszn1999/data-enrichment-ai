// Read-only check against a real store: connection, granted scopes, guard, a product read.
// Run: npx tsx --env-file=.env.local --env-file=../.env.local spike/store-agent-shopify.ts <workspaceId>
import { createClient } from "@supabase/supabase-js";
import { grantedScopes, loadShopifyConnection, shopifyGraphql } from "../src/store-agent/shopify/client";
import { inspectShopifyDocument, missingScopes } from "../src/store-agent/shopify/guard";
import { STORE_AGENT_SCOPES } from "../src/store-agent/shopify/scopes";

const workspaceId = process.argv[2];
if (!workspaceId) throw new Error("usage: store-agent-shopify.ts <workspaceId>");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const conn = await loadShopifyConnection(db, workspaceId);
console.log("store:", conn.storeName, conn.shopDomain);
const granted = await grantedScopes(conn);
console.log("granted scopes:", [...granted].sort().join(", "));
console.log("agent scopes missing on this store:", missingScopes([...STORE_AGENT_SCOPES], granted).join(", ") || "none");

const query = "{ productsCount { count } products(first: 3) { nodes { id title status totalInventory } } }";
const verdict = inspectShopifyDocument(query);
console.log("guard:", verdict);
const res = await shopifyGraphql(conn, query);
console.log("result:", JSON.stringify(res.data, null, 2));
console.log("cost:", res.extensions?.cost);
console.log("orders refused:", inspectShopifyDocument("{ orders(first:1){ nodes { id } } }"));

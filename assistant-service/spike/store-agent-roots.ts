// Compare the guard's allowlist with the live Admin API: root fields that look
// like they belong to the agent's areas but are not listed, and listed fields
// the API no longer has.
// Run: npx tsx --env-file=.env.local --env-file=../.env --env-file=../.env.local spike/store-agent-roots.ts <workspaceId>
import { createClient } from "@supabase/supabase-js";
import { createResilientFetch } from "../src/store-agent/resilient-fetch";
import { loadShopifyConnection, shopifyGraphql } from "../src/store-agent/shopify/client";
import { MUTATION_ROOTS, QUERY_ROOTS } from "../src/store-agent/shopify/scopes";

const [workspaceId] = process.argv.slice(2);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, global: { fetch: createResilientFetch() } });
const conn = await loadShopifyConnection(db, workspaceId!);
const res = await shopifyGraphql(conn, `{ q: __type(name: "QueryRoot") { fields { name } } m: __type(name: "Mutation") { fields { name } } }`);
const data = res.data as { q: { fields: Array<{ name: string }> }; m: { fields: Array<{ name: string }> } };
const AREAS = /product|variant|collection|inventory|location|file|publication|publish|channel|media|staged|bulkOperation/i;

for (const [label, live, listed] of [
  ["query", data.q.fields.map((f) => f.name), QUERY_ROOTS],
  ["mutation", data.m.fields.map((f) => f.name), MUTATION_ROOTS],
] as const) {
  const liveSet = new Set(live);
  console.log(`\n${label}: in our areas but not allowed:`, live.filter((n) => AREAS.test(n) && !(n in listed)).join(", ") || "none");
  console.log(`${label}: allowed but not in the API:`, Object.keys(listed).filter((n) => !liveSet.has(n)).join(", ") || "none");
}

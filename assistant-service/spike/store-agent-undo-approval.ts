// Undo one applied change through the service route and check the store is back
// to the values saved before it. Run (service on :4100):
// npx tsx --env-file=.env.local --env-file=../.env --env-file=../.env.local spike/store-agent-undo-approval.ts <approvalId> <userId>
import { createClient } from "@supabase/supabase-js";
import { signRequest } from "../src/auth";
import { createResilientFetch } from "../src/store-agent/resilient-fetch";
import { FILES_BUCKET } from "../src/store-agent/files";
import { loadShopifyConnection, shopifyGraphql } from "../src/store-agent/shopify/client";
import type { Backup } from "../src/store-agent/shopify/snapshot";

const [approvalId, userId] = process.argv.slice(2);
if (!approvalId || !userId) throw new Error("usage: store-agent-undo-approval.ts <approvalId> <userId>");
const secret = process.env.ASSISTANT_SERVICE_SECRET!;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, global: { fetch: createResilientFetch() } });

const { data: approval } = await db.from("store_agent_approvals").select("workspace_id, summary, backup_path, undoable, applied_at, undone_at").eq("id", approvalId).single();
if (!approval?.backup_path) throw new Error("no backup for this change");
console.log("CHANGE", approval.summary, "| applied:", !!approval.applied_at, "| undone:", !!approval.undone_at);
const { data: blob } = await db.storage.from(FILES_BUCKET).download(approval.backup_path);
const backup = JSON.parse(await blob!.text()) as Backup;
const conn = await loadShopifyConnection(db, approval.workspace_id);

const fields = [...new Set(backup.records.flatMap((r) => Object.keys(r.before)))];
const read = async () => {
  const out = new Map<string, Record<string, unknown>>();
  const ids = backup.records.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const res = await shopifyGraphql(
      conn,
      `query($ids:[ID!]!){ nodes(ids:$ids){ id ... on Product { title tags seo { title description } } ... on ProductVariant { price compareAtPrice } } }`,
      { ids: ids.slice(i, i + 100) }
    );
    for (const n of (res.data as { nodes: Array<Record<string, unknown>> }).nodes) out.set(String(n.id), n);
  }
  return out;
};
const norm = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort().join("|") : v === null || v === undefined ? "" : String(v));
const differences = (state: Map<string, Record<string, unknown>>) =>
  backup.records.filter((r) => Object.entries(r.before).some(([f, v]) => norm(state.get(r.id)?.[f]) !== norm(v))).length;

console.log(`records: ${backup.records.length}, fields: ${fields.join(", ")}`);
console.log("differ from the saved 'before' values now:", differences(await read()));

async function undo() {
  const raw = JSON.stringify({ approvalId });
  const ts = Date.now();
  const res = await fetch("http://127.0.0.1:4100/store-agent/approvals/undo", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-assistant-user": userId!,
      "x-assistant-timestamp": String(ts),
      "x-assistant-signature": signRequest({ secret, timestamp: ts, userId: userId!, method: "POST", path: "/store-agent/approvals/undo", body: raw }),
    },
  });
  return `${res.status} ${await res.text()}`;
}

const started = Date.now();
console.log("UNDO", await undo(), `${Math.round((Date.now() - started) / 1000)}s`);
console.log("UNDO AGAIN", await undo());
const left = differences(await read());
console.log("differ after undo:", left);
console.log(left === 0 ? "PASS: every record is back to its saved value" : "FAIL");

// Undo one applied WooCommerce change through the service route and check the
// store is back to the values saved before it. Run (service on :4100):
// npx tsx --env-file=.env.local --env-file=../.env --env-file=../.env.local spike/store-agent-woo-undo.ts <approvalId> <userId>
import { createClient } from "@supabase/supabase-js";
import { signRequest } from "../src/auth";
import { FILES_BUCKET } from "../src/store-agent/files";
import { createResilientFetch } from "../src/store-agent/resilient-fetch";
import type { Backup } from "../src/store-agent/shopify/snapshot";
import { loadWooConnection, wooRequest } from "../src/store-agent/woocommerce/client";
import { parseTargetKey, wooCollectionPath } from "../src/store-agent/woocommerce/snapshot";

const [approvalId, userId] = process.argv.slice(2);
if (!approvalId || !userId) throw new Error("usage: store-agent-woo-undo.ts <approvalId> <userId>");
const secret = process.env.ASSISTANT_SERVICE_SECRET!;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, global: { fetch: createResilientFetch() } });

const { data: approval } = await db.from("store_agent_approvals").select("workspace_id, summary, backup_path, applied_at, undone_at").eq("id", approvalId).single();
if (!approval?.backup_path) throw new Error("no backup for this change");
console.log("CHANGE", approval.summary, "| applied:", !!approval.applied_at, "| undone:", !!approval.undone_at);
const { data: blob } = await db.storage.from(FILES_BUCKET).download(approval.backup_path);
const backup = JSON.parse(await blob!.text()) as Backup;
const conn = await loadWooConnection(db, approval.workspace_id);

// Compare in the shape the backup saved: lists of { id } by id, other values as text.
const norm = (v: unknown): string => {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" && "id" in x ? String((x as { id: unknown }).id) : JSON.stringify(x))).sort().join("|");
  if (v && typeof v === "object") return "id" in (v as object) ? String((v as { id: unknown }).id) : JSON.stringify(v);
  return v === null || v === undefined ? "" : String(v);
};
const read = async () => {
  const out = new Map<string, Record<string, unknown>>();
  for (const r of backup.records) {
    const t = parseTargetKey(r.id)!;
    const res = await wooRequest(conn, { method: "GET", path: `${wooCollectionPath(t.type, t.parent)}/${t.id}`, query: { context: "edit" } });
    if (res.ok) out.set(r.id, res.data as Record<string, unknown>);
  }
  return out;
};
const metaValue = (node: Record<string, unknown> | undefined, key: string) =>
  ((node?.meta_data as Array<{ key: string; value: unknown }>) ?? []).find((m) => m.key === key)?.value ?? "";
const differences = (state: Map<string, Record<string, unknown>>) => {
  const diffs: string[] = [];
  for (const r of backup.records) {
    for (const [field, saved] of Object.entries(r.before)) {
      if (field === "meta_data") {
        for (const m of saved as Array<{ key: string; value: unknown }>) {
          if (norm(metaValue(state.get(r.id), m.key)) !== norm(m.value)) diffs.push(`${r.id} meta ${m.key}`);
        }
      } else if (norm(state.get(r.id)?.[field]) !== norm(saved)) diffs.push(`${r.id} ${field}: now ${norm(state.get(r.id)?.[field]).slice(0, 60)} saved ${norm(saved).slice(0, 60)}`);
    }
  }
  return diffs;
};

console.log(`records: ${backup.records.length}, fields: ${[...new Set(backup.records.flatMap((r) => Object.keys(r.before)))].join(", ")}`);
console.log("differ from the saved 'before' values now:", differences(await read()).length);

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
console.log("differ after undo:", left.length, left.slice(0, 5));
console.log(left.length === 0 ? "PASS: every record is back to its saved value" : "FAIL");

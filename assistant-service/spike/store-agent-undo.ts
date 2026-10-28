// Controlled write + undo test on the connected store:
// remember 3 products' SEO titles, let the agent change them with
// shopify_bulk_update (auto-approved here), check the store, undo through
// the service route, and check every value came back.
// Run: npx tsx --env-file=.env.local --env-file=../.env --env-file=../.env.local spike/store-agent-undo.ts
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { signRequest } from "../src/auth";
import { createResilientFetch } from "../src/store-agent/resilient-fetch";
import { loadShopifyConnection, shopifyGraphql } from "../src/store-agent/shopify/client";

const WS = "b13fd1f7-02da-4efc-af1a-ead12f14c155";
const USER = "ff85a680-e373-470d-b762-89856ed60a0a";
const secret = process.env.ASSISTANT_SERVICE_SECRET!;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
  global: { fetch: createResilientFetch(fetch, (m) => console.log("  (net)", m)) },
});
const conn = await loadShopifyConnection(db, WS);

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const raw = method === "GET" ? "" : JSON.stringify(body);
  const ts = Date.now();
  return fetch(`http://127.0.0.1:4100${path}`, {
    method,
    body: method === "GET" ? undefined : raw,
    headers: {
      "content-type": "application/json",
      "x-assistant-user": USER,
      "x-assistant-timestamp": String(ts),
      "x-assistant-signature": signRequest({ secret, timestamp: ts, userId: USER, method, path, body: raw }),
    },
  });
}

const read = async () => {
  const res = await shopifyGraphql(conn, "{ products(first: 3, sortKey: TITLE) { nodes { id title seo { title } } } }");
  return (res.data as { products: { nodes: Array<{ id: string; title: string; seo: { title: string | null } }> } }).products.nodes;
};

const before = await read();
console.log("BEFORE", before.map((p) => `${p.title} → ${p.seo.title ?? "(none)"}`));

const { data: chat } = await db.from("store_agent_chats").insert({ workspace_id: WS, user_id: USER }).select("id").single();
const runId = randomUUID();
const res = await call("POST", "/store-agent/runs", {
  runId,
  chatId: chat!.id,
  workspaceId: WS,
  userId: USER,
  message: `For exactly these 3 products: ${before.map((p) => p.id).join(", ")} — set each one's SEO title to "<product title> | Official Store". Use shopify_bulk_update with one row per product. Do not change anything else.`,
  attachments: [],
  model: { id: "composer-2.5", params: [{ id: "fast", value: "false" }] },
  mode: "agent",
  autoRun: false,
  billing: { ownerUserId: USER, remainingCredits: 1000 },
});
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";
let approvalId = "";
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (e.type === "tool_start") console.log("TOOL", e.tool, e.detail ?? "");
    if (e.type === "tool_end" && !e.ok) console.log("  FAILED", e.summary);
    if (e.type === "approval") {
      approvalId = e.approvalId;
      console.log("APPROVAL", e.risk, e.records, "records;", e.preview?.items.map((i: { label: string; changes: Array<{ field: string; before?: string; after?: string }> }) => `${i.label}: ${i.changes.map((c) => `${c.field} "${c.before}" → "${c.after}"`).join("; ")}`));
      await call("POST", "/store-agent/approvals", { runId, approvalId: e.approvalId, approve: true });
    }
    if (e.type === "approval_resolved") console.log("RESOLVED", e.status, "undoable:", e.undoable);
    if (e.type === "progress") process.stdout.write(`.`);
    if (e.type === "done") console.log("\nDONE", e.status, e.credits, "credits");
  }
}

const after = await read();
console.log("AFTER", after.map((p) => `${p.title} → ${p.seo.title ?? "(none)"}`));

if (approvalId) {
  const undo = await call("POST", "/store-agent/approvals/undo", { approvalId });
  console.log("UNDO", undo.status, JSON.stringify(await undo.json()));
  const again = await call("POST", "/store-agent/approvals/undo", { approvalId });
  console.log("UNDO TWICE", again.status, JSON.stringify(await again.json()));
}
const restored = await read();
console.log("RESTORED", restored.map((p) => `${p.title} → ${p.seo.title ?? "(none)"}`));
const same = before.every((b, i) => (b.seo.title ?? null) === (restored[i]!.seo.title ?? null));
console.log(same ? "PASS: store is back to its original values" : "FAIL: values differ");
const { data: audit } = await db.from("store_agent_audit_log").select("operation, ok, affected_ids").eq("chat_id", chat!.id).order("created_at");
console.log("AUDIT", JSON.stringify(audit?.map((a) => [a.operation, a.ok, (a.affected_ids as string[]).length])));

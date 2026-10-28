// Limits of the running service (:4100): at most 2 live runs per workspace and
// one per chat. Starts runs over HTTP, prints the answers, then stops them.
// Run: npx tsx --env-file=.env.local --env-file=../.env --env-file=../.env.local spike/store-agent-concurrency.ts <workspaceId> <userId>
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { signRequest } from "../src/auth";

const [workspaceId, userId] = process.argv.slice(2);
if (!workspaceId || !userId) throw new Error("usage: store-agent-concurrency.ts <workspaceId> <userId>");
const secret = process.env.ASSISTANT_SERVICE_SECRET!;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function post(path: string, body: unknown) {
  const raw = JSON.stringify(body);
  const ts = Date.now();
  return fetch(`http://127.0.0.1:4100${path}`, {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-assistant-user": userId!,
      "x-assistant-timestamp": String(ts),
      "x-assistant-signature": signRequest({ secret, timestamp: ts, userId: userId!, method: "POST", path, body: raw }),
    },
  });
}

const start = (chatId: string) => {
  const runId = randomUUID();
  return post("/store-agent/runs", {
    runId,
    chatId,
    workspaceId,
    userId,
    message: "Count my products with one read, then reply with the number.",
    attachments: [],
    model: { id: "composer-2.5", params: [{ id: "fast", value: "false" }] },
    mode: "agent",
    autoRun: false,
    autoRunBulk: false,
    billing: { ownerUserId: userId, remainingCredits: 100 },
  }).then(async (res) => ({ runId, chatId, status: res.status, body: res.status === 200 ? "(streaming)" : await res.text(), res }));
};

const chats: string[] = [];
for (let i = 0; i < 3; i++) {
  const { data } = await db.from("store_agent_chats").insert({ workspace_id: workspaceId, user_id: userId, title: `Concurrency ${i + 1}` }).select("id").single();
  chats.push(data!.id as string);
}

const first = await Promise.all(chats.map(start));
for (const r of first) console.log(`chat ${r.chatId.slice(0, 8)}: ${r.status} ${r.body}`);
const busy = first.find((r) => r.status === 200)!;
const again = await start(busy.chatId);
console.log(`second run in a busy chat: ${again.status} ${again.body}`);

for (const r of first.filter((x) => x.status === 200)) {
  const res = await post("/store-agent/runs/cancel", { runId: r.runId });
  console.log(`stop ${r.runId.slice(0, 8)}: ${res.status}`);
  void r.res.body?.cancel();
}
await new Promise((resolve) => setTimeout(resolve, 8000));
const { data: rows } = await db.from("store_agent_runs").select("chat_id, status").in("chat_id", chats);
console.log("run rows:", JSON.stringify(rows));
console.log("chats to delete:", chats.join(" "));

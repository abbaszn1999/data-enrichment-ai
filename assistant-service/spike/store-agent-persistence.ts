// Proves the Supabase agent store end to end with a real Cursor agent:
// create → reply → flush → drop the process state → resume from Supabase →
// the agent still remembers. Run: npx tsx --env-file=.env.local --env-file=../.env.local spike/store-agent-persistence.ts <workspaceId>
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Agent, type AgentOptions } from "@cursor/sdk";
import { createClient } from "@supabase/supabase-js";
import { SupabaseAgentStoreBackend } from "../src/store-agent/agent-store/supabase-backend";
import { WriteBehindAgentStore } from "../src/store-agent/agent-store/write-behind-store";

const workspaceId = process.argv[2];
if (!workspaceId) throw new Error("usage: store-agent-persistence.ts <workspaceId>");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const backend = new SupabaseAgentStoreBackend(db);
const cwd = path.join(os.tmpdir(), "store-agent-spike", workspaceId, randomUUID());
mkdirSync(cwd, { recursive: true });

function options(store: WriteBehindAgentStore): AgentOptions {
  return {
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: "composer-2.5", params: [{ id: "fast", value: "false" }] },
    tools: [],
    local: { cwd, settingSources: [], store },
  };
}

async function reply(agent: Awaited<ReturnType<typeof Agent.create>>, text: string) {
  const started = Date.now();
  let streamed = "";
  const run = await agent.send(text, {
    onDelta: ({ update }) => {
      const u = update as { type: string; text?: string };
      if (u.type === "text-delta" && typeof u.text === "string") streamed += u.text;
    },
  });
  const result = await run.wait();
  return { status: result.status, text: (result.result ?? streamed).trim(), ms: Date.now() - started };
}

const first = new WriteBehindAgentStore(backend, console.log);
const agent = await Agent.create(options(first));
const a = await reply(agent, "Remember this code word: PISTACHIO-42. Reply only with OK.");
console.log("turn 1:", a);
const t0 = Date.now();
await first.flush();
console.log(`flush: ${Date.now() - t0}ms, dirty after=${first.isDirty}`);
const agentId = agent.agentId;
await agent[Symbol.asyncDispose]();

const { count: events } = await db.from("agent_store_run_events").select("*", { count: "exact", head: true });
const blobs = await backend.listBlobs(agentId);
console.log(`stored: agent=${agentId} events=${events} blobs=${blobs.length}`);

// Fresh store: nothing in memory, everything must come from Supabase.
const second = new WriteBehindAgentStore(backend, console.log);
const resumed = await Agent.resume(agentId, options(second));
const b = await reply(resumed, "What was the code word? Reply with the code word only.");
console.log("turn 2 (resumed):", b);
await second.flush();
await resumed[Symbol.asyncDispose]();
console.log(b.text.includes("PISTACHIO-42") ? "PASS: memory survived" : "FAIL: memory lost");

// Clean up the spike agent.
await second.deleteAgentsEverywhere([agentId]);
console.log("cleaned up");

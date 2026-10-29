// End-to-end run of the Store Agent runner against the local database and the
// connected store, without HTTP. Prints the event stream and the saved rows.
// Run: npx tsx --env-file=.env.local --env-file=../.env.local spike/store-agent-e2e.ts <workspaceId> <userId> "<message>" [chatId]
// Env: SPIKE_MODEL, SPIKE_PARAMS (JSON), SPIKE_APPROVE=1 (approve changes, else decline),
//      SPIKE_MODE=plan, SPIKE_AUTORUN=1 (Auto-run as an owner), SPIKE_ATTACH=<local file>,
//      SPIKE_ANSWER=<option to pick when asked; default the first>, SPIKE_CREDITS=<balance, default 1000>,
//      SPIKE_CANCEL_AFTER=<seconds>, SPIKE_STEER_AFTER=<seconds> with SPIKE_STEER=<guidance text>,
//      SPIKE_BUILD_PLAN=<plan id> (the Build button: runs that plan in Agent mode)
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { installDnsCache } from "../src/dns-cache";
import { createResilientFetch } from "../src/store-agent/resilient-fetch";
installDnsCache();
import { SupabaseAgentStoreBackend } from "../src/store-agent/agent-store/supabase-backend";
import { WriteBehindAgentStore } from "../src/store-agent/agent-store/write-behind-store";
import { ChatFiles, mimeFor } from "../src/store-agent/files";
import { StoreAgentRegistry } from "../src/store-agent/run";
import { executeStoreRun } from "../src/store-agent/runner";

const [workspaceId, userId, message, existingChat] = process.argv.slice(2);
if (!workspaceId || !userId || !message) throw new Error("usage: store-agent-e2e.ts <workspaceId> <userId> <message> [chatId]");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, global: { fetch: createResilientFetch() } });
const store = new WriteBehindAgentStore(new SupabaseAgentStoreBackend(db), console.log);
const registry = new StoreAgentRegistry();
const workRoot = path.join(os.tmpdir(), "store-agent-work");

let chatId = existingChat;
if (!chatId) {
  const { data, error } = await db.from("store_agent_chats").insert({ workspace_id: workspaceId, user_id: userId }).select("id").single();
  if (error) throw error;
  chatId = data.id as string;
}
console.log("chat:", chatId);

// An attachment as the gateway would store it: uploaded to the chat's files first.
const attachments = [];
if (process.env.SPIKE_ATTACH) {
  const local = process.env.SPIKE_ATTACH;
  const name = path.basename(local);
  const bytes = await fs.readFile(local);
  const files = new ChatFiles(db, path.join(workRoot, workspaceId, chatId), workspaceId, chatId);
  const relative = `uploads/${randomUUID().slice(0, 8)}-${name}`;
  const fileId = await files.store(relative, bytes, "user", null);
  attachments.push({ fileId, name, mime: mimeFor(name), size: bytes.length, storagePath: files.storagePath(relative) });
}

const autoRun = process.env.SPIKE_AUTORUN === "1";
const run = registry.create({
  runId: randomUUID(),
  chatId,
  workspaceId,
  userId,
  message,
  attachments,
  model: process.env.SPIKE_MODEL ? { id: process.env.SPIKE_MODEL, params: JSON.parse(process.env.SPIKE_PARAMS ?? "[]") } : { id: "composer-2.5", params: [{ id: "fast", value: "false" }] },
  mode: process.env.SPIKE_MODE === "plan" ? "plan" : "agent",
  autoRun,
  autoRunBulk: autoRun,
  billing: { ownerUserId: userId, remainingCredits: Number(process.env.SPIKE_CREDITS ?? 1000) },
  ...(process.env.SPIKE_BUILD_PLAN ? { buildPlanId: process.env.SPIKE_BUILD_PLAN } : {}),
});
if (process.env.SPIKE_CANCEL_AFTER) {
  setTimeout(() => {
    console.log("\n[spike] stopping the run");
    run.cancel();
  }, Number(process.env.SPIKE_CANCEL_AFTER) * 1000);
}
if (process.env.SPIKE_STEER_AFTER && process.env.SPIKE_STEER) {
  setTimeout(() => {
    console.log("\n[spike] steering:", process.env.SPIKE_STEER);
    // Same path as POST /store-agent/runs/steer.
    const id = run.addGuidance(process.env.SPIKE_STEER!);
    void run
      .steer?.(process.env.SPIKE_STEER!)
      .then((outcome) => {
        console.log("\n[spike] steer outcome:", outcome);
        if (outcome === "complete_delivered") run.guidanceDelivered(id);
      })
      .catch((e: unknown) => console.log("[spike] steer failed", e));
  }, Number(process.env.SPIKE_STEER_AFTER) * 1000);
}

let thinking = 0;
run.subscribe((event) => {
  if (event.type === "text") process.stdout.write(event.delta);
  else if (event.type === "thinking" || event.type === "progress" || event.type === "ping") {
    if (event.type === "thinking") thinking += event.delta.length;
  } else if (event.type === "approval") {
    console.log(`\n[approval ${event.risk}, ${event.records ?? "?"} records]`, event.summary, event.operations, JSON.stringify(event.preview)?.slice(0, 500));
    setTimeout(() => run.decide(event.approvalId, process.env.SPIKE_APPROVE === "1"), 500);
  } else if (event.type === "question") {
    // Each question: the option named in SPIKE_ANSWER when it is one, else the first.
    for (const q of event.questions) console.log("\n[question]", q.text, q.options);
    const picks = event.questions.map((q) => [q.options.find((o) => o === process.env.SPIKE_ANSWER) ?? q.options[0]!]);
    setTimeout(() => run.answer(event.questionId, picks), 500);
  } else console.log(`\n[${event.type}]`, JSON.stringify(event).slice(0, 400));
});

const started = Date.now();
await executeStoreRun(
  {
    db,
    store,
    registry,
    cursorApiKey: process.env.CURSOR_API_KEY!,
    workRoot,
    log: console.log,
  },
  run
);
console.log(`\n\nthinking chars: ${thinking}, took ${Math.round((Date.now() - started) / 1000)}s`);

const { data: runRow } = await db.from("store_agent_runs").select("status, error, input_tokens, output_tokens, cache_read_tokens, usd, credits").eq("id", run.id).single();
console.log("run row:", JSON.stringify(runRow));
const { data: files } = await db.from("store_agent_files").select("name, kind, size").eq("chat_id", chatId).eq("run_id", run.id);
console.log("files:", JSON.stringify(files));
const { data: chat } = await db.from("store_agent_chats").select("title, status, credits_total, context_used, context_window").eq("id", chatId).single();
console.log("chat:", JSON.stringify(chat));

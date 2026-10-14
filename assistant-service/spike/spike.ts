/**
 * Verification spike. Run once, locally, before building on the SDK:
 *
 *   CURSOR_API_KEY=... npm run spike
 *
 * It uses two harmless read-only custom tools and checks the open questions in
 * the plan. Nothing here touches the app, the database or the network beyond
 * the Cursor API itself.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agent, Cursor, JsonlLocalAgentStore } from "@cursor/sdk";

type Check = { name: string; ok: boolean; note: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, note = "") => {
  checks.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`);
};

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error("Set CURSOR_API_KEY (local shell only) and run again.");
  process.exit(1);
}

const workdir = join(tmpdir(), `assistant-spike-${Date.now()}`);
mkdirSync(join(workdir, ".cursor", "rules"), { recursive: true });
writeFileSync(join(workdir, "AGENTS.md"), "# Spike\nWhen asked for the secret word, call the tool `get_secret_word` and answer with exactly the word it returns.\n");
writeFileSync(
  join(workdir, ".cursor", "rules", "spike.mdc"),
  "---\nalwaysApply: true\n---\nThe code name of this project is MARIGOLD. If asked for the code name, answer MARIGOLD.\n"
);

async function main() {
  // 1. Model catalog.
  const models = await Cursor.models.list({ apiKey });
  console.log(`models available: ${models.map((m) => m.id).join(", ")}`);
  record("model catalog readable", models.length > 0, `${models.length} models`);
  const modelId = process.env.SPIKE_MODEL || models.find((m) => m.id === "composer-2.5")?.id || models[0]?.id;
  if (!modelId) throw new Error("No model available");
  console.log(`using model: ${modelId}`);

  let slowToolMs = 0;
  let secretCalls = 0;
  const agent = await Agent.create({
    apiKey,
    model: { id: modelId },
    tools: ["mcp"],
    local: {
      cwd: workdir,
      settingSources: ["project"],
      store: new JsonlLocalAgentStore(join(workdir, "store")),
      customTools: {
        get_secret_word: {
          description: "Returns the secret word. Call it when asked for the secret word.",
          inputSchema: { type: "object", properties: {}, required: [] },
          async execute() {
            secretCalls += 1;
            return "tangerine";
          },
        },
        slow_lookup: {
          description: "Looks something up in the user's browser. Takes about 30 seconds. Call it when asked to do a slow lookup.",
          inputSchema: { type: "object", properties: {}, required: [] },
          async execute() {
            const started = Date.now();
            await new Promise((resolve) => setTimeout(resolve, 30_000));
            slowToolMs = Date.now() - started;
            return "lookup finished";
          },
        },
      },
    },
  });

  try {
    // 2. Custom tools survive tools:["mcp"] and AGENTS.md / rules load.
    const started = Date.now();
    const run1 = await agent.send("What is the secret word, and what is this project's code name? Reply in one short sentence.");
    const toolNames: string[] = [];
    for await (const event of run1.stream()) {
      if (event.type === "tool_call" && event.status === "running") toolNames.push(event.name);
    }
    const result1 = await run1.wait();
    const text1 = (result1.result ?? "").toLowerCase();
    console.log(`answer 1: ${result1.result}`);
    record("custom tool is called with tools:[mcp]", secretCalls > 0 && text1.includes("tangerine"), `calls=${secretCalls} tools=${toolNames.join("|")}`);
    record("rules / AGENTS.md are loaded", text1.includes("marigold"));
    record("built-in tools are not offered", !toolNames.some((n) => ["shell", "read", "edit", "write", "grep", "glob", "ls"].includes(n)), toolNames.join("|"));
    record("step latency is measured", true, `${Date.now() - started} ms for a one-tool run`);

    // 3. A tool that waits 30 seconds.
    const run2 = await agent.send("Do the slow lookup now, then say done.");
    const result2 = await run2.wait();
    record("a 30 s tool call completes", slowToolMs >= 29_000 && result2.status === "finished", `status=${result2.status} waited=${slowToolMs} ms`);

    // 4. Usage.
    record("run.usage is reported", Boolean(result1.usage?.totalTokens), JSON.stringify(result1.usage ?? {}));
    try {
      const usage = await agent.getUsage();
      record("getUsage() works for local agents", true, `charged=${usage.cost?.chargedCents ?? "n/a"} cents`);
    } catch (error) {
      record("getUsage() works for local agents", false, (error as Error).message);
    }
  } finally {
    await agent[Symbol.asyncDispose]();
  }

  // 5. systemPrompt access (optional feature, not required by the design).
  try {
    const probe = await Agent.create({
      apiKey,
      model: { id: modelId },
      systemPrompt: "Answer with the single word OK.",
      tools: [],
      local: { cwd: workdir, store: new JsonlLocalAgentStore(join(workdir, "store2")) },
    });
    const run = await probe.send("ping");
    await run.wait();
    await probe[Symbol.asyncDispose]();
    record("systemPrompt override available (not used)", true);
  } catch (error) {
    record("systemPrompt override available (not used)", false, (error as Error).message);
  }

  const failed = checks.filter((c) => !c.ok && !c.name.includes("not used"));
  console.log(failed.length === 0 ? "\nSPIKE OK: safe to continue." : `\nSPIKE FAILED: ${failed.map((c) => c.name).join("; ")}`);
  process.exit(failed.length === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error("spike crashed:", error);
  process.exit(1);
});

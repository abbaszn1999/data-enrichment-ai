import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { Agent } from "@cursor/sdk";

const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cost-probe-"));

async function probe(fast: boolean) {
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY!,
    model: { id: "composer-2.5", params: [{ id: "fast", value: String(fast) }] },
    local: { cwd, settingSources: [] },
    tools: [],
  });
  try {
    const started = Date.now();
    const run = await agent.send("Reply with the single word OK.");
    const result = await run.wait();
    console.log(`fast=${fast} status=${result.status} ms=${Date.now() - started} tokens=${JSON.stringify(result.usage)}`);
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const usage = await agent.getUsage();
        console.log(`  getUsage try ${attempt}: cost=${JSON.stringify(usage.cost)} runs=${usage.runs.length} first=${JSON.stringify(usage.runs[0] ?? null)}`);
        if (usage.cost) break;
      } catch (error) {
        const e = error as { code?: string; message?: string };
        console.log(`  getUsage failed: code=${e.code} ${e.message?.slice(0, 160)}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}

await probe(true);
await probe(false);

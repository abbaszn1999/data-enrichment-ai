// Prints the raw stream messages of one short run, to see how tool calls and thinking arrive.
import { Agent } from "@cursor/sdk";

const agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY!,
  model: { id: process.env.ASSISTANT_MODEL ?? "composer-2.5" },
  tools: ["mcp"],
  local: { cwd: process.cwd(), settingSources: [] },
});
const run = await agent.send("Call the lookup tool with term 'gallery', then answer in one sentence.", {
  local: {
    customTools: {
      lookup: {
        description: "Look up a term",
        inputSchema: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
        execute: async () => ({ content: [{ type: "text", text: "gallery is at /w/x/products-gallery" }] }),
      },
    },
  },
});
for await (const message of run.stream()) {
  if (message.type === "assistant" || message.type === "thinking" || message.type === "tool_call") {
    console.log(JSON.stringify(message).slice(0, 700));
  } else {
    console.log("-", message.type);
  }
}
await run.wait();
await agent[Symbol.asyncDispose]();

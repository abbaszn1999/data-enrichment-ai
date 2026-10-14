// Manual smoke test: sends one signed run to the local service and prints the events.
import { signRequest } from "../src/auth";

const secret = process.env.ASSISTANT_SERVICE_SECRET ?? "";
const userId = "smoke-user";
const body = JSON.stringify({
  runId: `smoke-${Date.now()}`,
  userId,
  workspaceId: "w1",
  message: process.argv[2] ?? "Say hello in one short sentence.",
  context: { workspaceSlug: "demo", workspaceId: "w1", path: "/w/demo" },
});
const timestamp = Date.now();
const signature = signRequest({ secret, timestamp, userId, method: "POST", path: "/runs", body });
const res = await fetch("http://127.0.0.1:4100/runs", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-assistant-signature": signature,
    "x-assistant-timestamp": String(timestamp),
    "x-assistant-user": userId,
  },
  body,
});
console.log("status", res.status);
const reader = res.body!.getReader();
const decoder = new TextDecoder();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  process.stdout.write(decoder.decode(value));
}

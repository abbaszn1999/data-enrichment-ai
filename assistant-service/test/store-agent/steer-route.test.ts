import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { signRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER, USER_HEADER } from "../../src/auth";
import { StoreAgentRegistry } from "../../src/store-agent/run";
import { mountStoreAgentRoutes, type StoreAgentRouteDeps } from "../../src/store-agent/routes";

const SECRET = "s".repeat(40);
const USER = "44444444-4444-4444-8444-444444444444";
const RUN = "33333333-3333-4333-8333-333333333333";

function setup() {
  const registry = new StoreAgentRegistry();
  const run = registry.create({
    runId: RUN,
    chatId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: USER,
    message: "find Dyson prices",
    attachments: [],
    model: { id: "m", params: [] },
    mode: "agent",
    autoRun: false,
    autoRunBulk: false,
    billing: { ownerUserId: USER, remainingCredits: 10 },
  });
  const app = new Hono();
  mountStoreAgentRoutes(app, { registry, secret: SECRET, log: () => undefined } as unknown as StoreAgentRouteDeps);
  return { app, run };
}

function steer(app: Hono, text: string) {
  const body = JSON.stringify({ runId: RUN, text });
  const timestamp = Date.now();
  const path = "/store-agent/runs/steer";
  return app.request(path, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      [USER_HEADER]: USER,
      [TIMESTAMP_HEADER]: String(timestamp),
      [SIGNATURE_HEADER]: signRequest({ secret: SECRET, timestamp, userId: USER, method: "POST", path, body }),
    },
  });
}

describe("steering a run", () => {
  it("shows the message in the reply and queues it for the agent", async () => {
    const { app, run } = setup();
    const res = await steer(app, "also count the free products");
    expect(res.status).toBe(200);
    expect(run.history.filter((e) => e.type === "guidance")).toMatchObject([{ type: "guidance", text: "also count the free products" }]);
    expect(run.takeGuidance()).toEqual(["also count the free products"]);
  });
});

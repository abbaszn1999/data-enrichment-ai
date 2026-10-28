import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SDKCustomTool } from "@cursor/sdk";
import { withGuidance } from "../../src/store-agent/guidance";
import { StoreAgentRun } from "../../src/store-agent/run";

const run = () =>
  new StoreAgentRun({
    runId: randomUUID(),
    chatId: randomUUID(),
    workspaceId: randomUUID(),
    userId: randomUUID(),
    message: "discount the watches",
    attachments: [],
    model: { id: "composer-2.5", params: [] },
    mode: "agent",
    autoRun: true,
    autoRunBulk: true,
    billing: { ownerUserId: randomUUID(), remainingCredits: 10 },
  });

describe("mid-run guidance", () => {
  it("stops the next tool call and hands the agent the user's message", async () => {
    const r = run();
    let applied = 0;
    const tools = withGuidance({ shopify_bulk_update: { execute: () => (++applied, "3 changed") } satisfies SDKCustomTool }, r);
    r.addGuidance("stop, don't change the prices");
    const blocked = (await tools.shopify_bulk_update!.execute({}, {})) as { content: Array<{ text: string }>; isError: boolean };
    expect(applied).toBe(0);
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0]!.text).toContain("stop, don't change the prices");
    // Delivered once; the agent may call again if the message does not change the step.
    expect(await tools.shopify_bulk_update!.execute({}, {})).toBe("3 changed");
    expect(applied).toBe(1);
  });

  it("does not repeat a message the SDK already delivered", () => {
    const r = run();
    const id = r.addGuidance("only the black ones");
    r.addGuidance("and keep the old price as compare-at");
    r.guidanceDelivered(id);
    expect(r.takeGuidance()).toEqual(["and keep the old price as compare-at"]);
    expect(r.takeGuidance()).toEqual([]);
  });
});

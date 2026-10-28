import { describe, expect, it } from "vitest";
import type { SDKCustomTool } from "@cursor/sdk";
import { oncePerToolCall } from "../../src/store-agent/call-once";

describe("oncePerToolCall", () => {
  it("runs a re-delivered tool call once and gives both deliveries its result", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tools = oncePerToolCall({
      change: {
        execute: async () => {
          runs++;
          await gate;
          return "applied";
        },
      } satisfies SDKCustomTool,
    });
    const first = tools.change!.execute({}, { toolCallId: "call-1" });
    const again = tools.change!.execute({}, { toolCallId: "call-1" });
    release();
    expect(await first).toBe("applied");
    expect(await again).toBe("applied");
    expect(runs).toBe(1);
  });

  it("runs different calls, and calls without an id, every time", async () => {
    let runs = 0;
    const tools = oncePerToolCall({ read: { execute: () => String(++runs) } });
    await tools.read!.execute({}, { toolCallId: "a" });
    await tools.read!.execute({}, { toolCallId: "b" });
    await tools.read!.execute({}, {});
    await tools.read!.execute({}, {});
    expect(runs).toBe(4);
  });
});

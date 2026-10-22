import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_LIMITS, isAllowedNavigation, isBlockedNavigation } from "../../src/lib/assistant/protocol";
import { RunLimitError, RunRegistry } from "../src/agent/bridge";
import { listDir, readFile, resolveInside, searchCode } from "../src/agent/tools/code-tools";
import { mapSdkMessage, mapTextDelta } from "../src/agent/events";
import { ContextMeter } from "../src/agent/context-meter";
import { createCodeTools, searchPattern } from "../src/agent/tools";
import { signRequest, verifyRequest } from "../src/auth";
import { billedCents, costToCredits, estimateUsd, usageToCredits } from "../src/usage";
import { defaultStoreDir } from "../src/config";
import { isMissingAgent } from "../src/agent/runner";

const ctx = { workspaceSlug: "acme", workspaceId: "w1", path: "/w/acme" };

async function makeRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "assistant-kb-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "a.ts"), "export const hello = 1;\nconst needle = 2;\n");
  await writeFile(path.join(root, ".env.local"), "SECRET=1");
  await writeFile(path.join(root, "src", "my-secret.ts"), "x");
  return root;
}

describe("code tools confinement", () => {
  it("reads files inside the root", async () => {
    const root = await makeRoot();
    expect(await readFile(root, "src/a.ts")).toContain("hello");
    expect(await listDir(root, "src")).toContain("a.ts");
    expect(await searchCode(root, "needle")).toContain("a.ts");
  });

  it("rejects traversal, absolute paths and secret names", async () => {
    const root = await makeRoot();
    await expect(resolveInside(root, "../x")).rejects.toThrow();
    await expect(resolveInside(root, "src/../../x")).rejects.toThrow();
    await expect(resolveInside(root, path.resolve(root, "src/a.ts"))).rejects.toThrow();
    await expect(readFile(root, ".env.local")).rejects.toThrow();
    await expect(readFile(root, "src/my-secret.ts")).rejects.toThrow();
  });

  it("does not list or search secret files", async () => {
    const root = await makeRoot();
    const listing = await listDir(root, "");
    expect(listing).not.toContain(".env");
    expect(await searchCode(root, "SECRET")).not.toContain(".env");
  });

  it("takes the search text as pattern or query", async () => {
    expect(searchPattern({ pattern: "needle" })).toBe("needle");
    expect(searchPattern({ query: "needle" })).toBe("needle");
    expect(searchPattern({ pattern: "", query: "needle" })).toBe("needle");
    expect(searchPattern({})).toBeNull();
    const root = await makeRoot();
    const tool = createCodeTools(root).search_code!;
    const result = await tool.execute({ query: "needle" }, {} as Parameters<typeof tool.execute>[1]);
    expect(JSON.stringify(result)).toContain("a.ts");
  });
});

describe("context meter", () => {
  it("estimates one model call's prompt from a reply's summed usage", () => {
    const meter = new ContextMeter(200_000);
    expect(meter.onUpdate({ type: "tool-requests-listed" })).toEqual([]);
    meter.onUpdate({ type: "tool-requests-listed" });
    const usage = { inputTokens: 24_000, outputTokens: 300, cacheReadTokens: 9_000, cacheWriteTokens: 0 };
    expect(meter.onUpdate({ type: "turn-ended", usage })).toEqual([{ type: "context", usedTokens: 11_300, windowTokens: 200_000 }]);
    expect(meter.onUpdate({ type: "turn-ended", usage })).toEqual([{ type: "context", usedTokens: 33_300, windowTokens: 200_000 }]);
  });

  it("reports summarization and caps at the window", () => {
    const meter = new ContextMeter(1_000);
    expect(meter.onUpdate({ type: "summary-started" })).toEqual([{ type: "summary", status: "started" }]);
    expect(meter.onUpdate({ type: "summary-completed" })).toEqual([{ type: "summary", status: "completed" }]);
    const usage = { inputTokens: 5_000, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(meter.onUpdate({ type: "turn-ended", usage })).toEqual([{ type: "context", usedTokens: 1_000, windowTokens: 1_000 }]);
    expect(meter.onUpdate({ type: "turn-ended" })).toEqual([]);
  });
});

describe("request signing", () => {
  const base = { secret: "s".repeat(40), userId: "u1", method: "POST", path: "/runs", body: "{}" };
  const now = Date.now();
  const sig = signRequest({ ...base, timestamp: now });

  it("accepts a valid signature", () => {
    expect(verifyRequest({ ...base, timestamp: String(now), signature: sig, now }).ok).toBe(true);
  });
  it("rejects tampering, other users and stale timestamps", () => {
    expect(verifyRequest({ ...base, body: "{\"x\":1}", timestamp: String(now), signature: sig, now }).ok).toBe(false);
    expect(verifyRequest({ ...base, userId: "u2", timestamp: String(now), signature: sig, now }).ok).toBe(false);
    expect(verifyRequest({ ...base, timestamp: String(now), signature: sig, now: now + 10 * 60_000 }).ok).toBe(false);
    expect(verifyRequest({ ...base, timestamp: undefined, signature: sig }).ok).toBe(false);
  });
});

describe("event mapping", () => {
  const call = (status: string, toolName: string, args: Record<string, unknown>, result?: unknown) => ({
    type: "tool_call",
    call_id: "c1",
    name: "mcp",
    status,
    args: { providerIdentifier: "custom-user-tools", toolName, args },
    result,
  });

  it("passes assistant text", () => {
    expect(mapSdkMessage({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } })).toEqual([
      { type: "text", text: "hi" },
    ]);
  });

  it("streams text from token deltas and can hide the repeated assistant message", () => {
    expect(mapTextDelta({ type: "text-delta", text: "Hel" })).toEqual({ type: "text", text: "Hel" });
    expect(mapTextDelta({ type: "text-delta", text: "" })).toBeNull();
    expect(mapTextDelta({ type: "thinking-delta", text: "secret" })).toBeNull();
    expect(mapSdkMessage({ type: "assistant", message: { content: [{ type: "text", text: "Hel" }] } }, { assistantText: false })).toEqual([]);
  });

  it("streams thinking without internal names", () => {
    const [event] = mapSdkMessage({ type: "thinking", text: "I will use CallDynamicTool via mcp" });
    expect(event).toEqual({ type: "thinking", text: "I will use tool via tool" });
    expect(mapSdkMessage({ type: "thinking", text: "", thinking_duration_ms: 380 })).toEqual([
      { type: "thinking_end", durationMs: 380 },
    ]);
  });

  it("describes tool steps from their arguments and results", () => {
    expect(mapSdkMessage(call("running", "click", { target: "ci.new.session-name" }))).toEqual([
      { type: "tool", id: "c1", status: "running", kind: "action", title: "Clicking", detail: "session name" },
    ]);
    const done = mapSdkMessage(
      call("completed", "search_code", { pattern: "gallery" }, {
        status: "success",
        value: { content: [{ text: { text: "src/a.ts:3: x\nsrc/b.ts:9: y" } }], isError: false },
      })
    );
    expect(done[0]).toMatchObject({ status: "completed", title: "Searching the platform", detail: '"gallery"', summary: "2 matches" });
    const failed = mapSdkMessage(
      call("completed", "click", { target: "ci.run" }, { status: "success", value: { content: [{ text: { text: "disabled" } }], isError: true } })
    );
    expect(failed[0]).toMatchObject({ status: "error", summary: "disabled" });
    expect(JSON.stringify([done, failed])).not.toMatch(/custom-user-tools|mcp/);
  });

  it("describes gallery steps", () => {
    expect(mapSdkMessage(call("running", "gallery_get_state", {}))[0]).toMatchObject({ title: "Reading the gallery" });
    expect(mapSdkMessage(call("running", "gallery_select_rows", { mode: "status", statuses: ["failed", "not_started"] }))[0]).toMatchObject({
      title: "Selecting products",
      detail: "failed, not_started",
    });
    expect(mapSdkMessage(call("running", "visualizer_get_state", {}))[0]).toMatchObject({ title: "Reading the visualizer" });
    expect(mapSdkMessage(call("running", "visualizer_select_rows", { mode: "all" }))[0]).toMatchObject({ title: "Selecting products", detail: "all" });
    expect(mapSdkMessage(call("running", "visualizer_set_columns", { columns: ["Title", "Brand"] }))[0]).toMatchObject({
      title: "Choosing columns",
      detail: "Title, Brand",
    });
    expect(mapSdkMessage(call("running", "classify_get_state", {}))[0]).toMatchObject({ title: "Reading the classification" });
    expect(mapSdkMessage(call("running", "website_get_state", {}))[0]).toMatchObject({ title: "Reading the header project" });
    expect(mapSdkMessage(call("running", "store_get_state", {}))[0]).toMatchObject({ title: "Reading the Store Assistant" });
    expect(mapSdkMessage(call("running", "upload_file", { target: "classify.new.file", fileIds: ["a", "b", "c"] }))[0]).toMatchObject({
      title: "Uploading the files",
      detail: "3 files",
    });
    expect(mapSdkMessage(call("running", "upload_file", { target: "visualizer.create.file", fileId: "a" }))[0]).toMatchObject({
      title: "Uploading the file",
    });
  });

  it("drops unknown messages", () => {
    expect(mapSdkMessage({ type: "usage", usage: {} })).toEqual([]);
    expect(mapSdkMessage({ type: "tool_call", call_id: "c", name: "x", status: "running" })).toEqual([]);
  });
});

describe("run limits and registry", () => {
  it("allows one active run per user and rejects duplicates", () => {
    const registry = new RunRegistry();
    registry.create({ id: "r1", userId: "u1", workspaceId: "w1", context: ctx });
    expect(() => registry.create({ id: "r2", userId: "u1", workspaceId: "w1", context: ctx })).toThrow(RunLimitError);
    registry.remove("r1");
    expect(() => registry.create({ id: "r2", userId: "u1", workspaceId: "w1", context: ctx })).not.toThrow();
  });

  it("stops after the action limit and resolves browser answers", async () => {
    const registry = new RunRegistry();
    const run = registry.create({ id: "r1", userId: "u1", workspaceId: "w1", context: ctx });
    const events: string[] = [];
    run.attachSink((event) => {
      if (event.type === "browser_action") {
        events.push(event.callId);
        run.resolve({ runId: "r1", callId: event.callId, ok: true });
      }
    });
    for (let i = 0; i < ASSISTANT_LIMITS.maxActionsPerRun; i += 1) {
      await run.request({ kind: "see_page" });
    }
    await expect(run.request({ kind: "see_page" })).rejects.toThrow(RunLimitError);
    expect(events.length).toBe(ASSISTANT_LIMITS.maxActionsPerRun);
  });

  it("rejects pending requests when cancelled", async () => {
    const registry = new RunRegistry();
    const run = registry.create({ id: "r1", userId: "u1", workspaceId: "w1", context: ctx });
    run.attachSink(() => {});
    const pending = run.request({ kind: "see_page" });
    run.cancel();
    await expect(pending).rejects.toThrow();
  });
});

describe("navigation rules", () => {
  it("allows only same-workspace paths and blocks billing areas", () => {
    expect(isAllowedNavigation("/w/acme/catalog-intelligence/new", "acme")).toBe(true);
    expect(isAllowedNavigation("/w/other/x", "acme")).toBe(false);
    expect(isAllowedNavigation("//evil.com", "acme")).toBe(false);
    expect(isAllowedNavigation("/w/acme/../x", "acme")).toBe(false);
    expect(isBlockedNavigation("/w/acme/settings/billing")).toBe(true);
  });
});

describe("cost", () => {
  it("rounds up to 0.001 credit with 10 credits per dollar", () => {
    expect(costToCredits(0.0545)).toBe(0.545);
    expect(costToCredits(0.00001)).toBe(0.001);
    expect(costToCredits(0)).toBe(0);
  });
  it("prefers billed cents over token estimates", () => {
    const rates = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(usageToCredits({ billedCents: 50, usage, rates }).source).toBe("billed");
    expect(billedCents({ chargedCents: 0, rawCostCents: 12 })).toBe(12);
    expect(billedCents({ chargedCents: 9, rawCostCents: 12 })).toBe(9);
    expect(usageToCredits({ usage, rates })).toMatchObject({ source: "estimated", credits: 20 });
    expect(usageToCredits({ rates }).source).toBe("none");
  });

  it("matches Cursor's usage export for a Composer 2.5 run", () => {
    const rates = { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0.5 };
    // Export row: input w/o cache write 7,718, cache read 39,129, output 796; the SDK reports input 46,847.
    const usage = { inputTokens: 46_847, outputTokens: 796, cacheReadTokens: 39_129, cacheWriteTokens: 0 };
    expect(estimateUsd(usage, rates)).toBeCloseTo(0.0136748, 7);
    expect(usageToCredits({ usage, rates }).credits).toBe(0.137);
  });
});

describe("store location", () => {
  const env = { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };

  it("moves the store off OneDrive onto the local disk", () => {
    expect(defaultStoreDir(env, "C:\\Users\\me\\OneDrive\\Desktop\\app", "win32")).toBe(
      path.join(env.LOCALAPPDATA, "autommerce-agent", "store")
    );
  });

  it("treats a missing saved agent as a conversation to start over", () => {
    expect(isMissingAgent(new Error("Agent abc not found"))).toBe(true);
    expect(isMissingAgent(new Error("network down"))).toBe(false);
    expect(isMissingAgent("not found")).toBe(false);
  });

  it("keeps an explicit directory and a normal project folder", () => {
    expect(defaultStoreDir({ ...env, ASSISTANT_STORE_DIR: "D:\\agent" }, "C:\\Users\\me\\OneDrive\\app", "win32")).toBe("D:\\agent");
    expect(defaultStoreDir(env, "C:\\dev\\app", "win32")).toBe(".store");
    expect(defaultStoreDir(env, "/home/me/OneDrive/app", "linux")).toBe(".store");
  });
});

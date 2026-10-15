import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_LIMITS, isAllowedNavigation, isBlockedNavigation } from "../../src/lib/assistant/protocol";
import { RunLimitError, RunRegistry } from "../src/agent/bridge";
import { listDir, readFile, resolveInside, searchCode } from "../src/agent/tools/code-tools";
import { mapSdkMessage } from "../src/agent/events";
import { signRequest, verifyRequest } from "../src/auth";
import { costToCredits, usageToCredits } from "../src/usage";

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
    expect(usageToCredits({ chargedCents: 50, usage, rates }).source).toBe("billed");
    expect(usageToCredits({ usage, rates })).toMatchObject({ source: "estimated", credits: 20 });
    expect(usageToCredits({ rates }).source).toBe("none");
  });
});

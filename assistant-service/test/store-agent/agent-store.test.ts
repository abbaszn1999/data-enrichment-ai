import type { LocalAgentDocument, LocalAgentRunDocument } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import { MemoryAgentStoreBackend } from "../../src/store-agent/agent-store/memory-backend";
import { WriteBehindAgentStore } from "../../src/store-agent/agent-store/write-behind-store";

const agent = (id: string, updatedAt = 1, cwd = "/w/a"): LocalAgentDocument => ({
  agentId: id,
  cwd,
  status: "idle",
  createdAt: 1,
  updatedAt,
  latestCheckpoint: { schemaVersion: 1, rootBlobId: "b1" },
});

const run = (agentId: string, runId: string, turnNumber = 1): LocalAgentRunDocument => ({
  runId,
  agentId,
  turnNumber,
  status: "running",
  createdAt: 1,
  updatedAt: 1,
});

const bytes = (s: string) => new TextEncoder().encode(s);

function setup() {
  const backend = new MemoryAgentStoreBackend();
  const store = new WriteBehindAgentStore(backend);
  return { backend, store };
}

describe("WriteBehindAgentStore", () => {
  it("closes runs a restart left open, after a reload from the backend", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: { ...agent("a1"), status: "running", activeRunId: "r2" } });
    await store.runs.create({ run: { ...run("a1", "r1", 1), status: "finished" } });
    await store.runs.create({ run: run("a1", "r2", 2) });
    await store.flush();

    const restarted = new WriteBehindAgentStore(backend);
    expect(await restarted.releaseStaleRuns("a1")).toBe(1);
    expect((await restarted.runs.get({ agentId: "a1", runId: "r2" }))?.status).toBe("cancelled");
    expect((await restarted.runs.get({ agentId: "a1", runId: "r1" }))?.status).toBe("finished");
    const healed = await restarted.agents.get({ agentId: "a1" });
    expect(healed?.status).toBe("idle");
    expect(healed?.activeRunId).toBeNull();
    expect(await restarted.releaseStaleRuns("a1")).toBe(0);
  });

  it("loads a resumed chat's memory in one go instead of blob by blob", async () => {
    const { backend, store } = setup();
    for (let i = 0; i < 300; i++) await store.checkpoints.create({ agentId: "a1", blobId: `b${i}`, data: bytes(`blob ${i}`) });
    await store.agents.create({ agent: agent("a1") });
    await store.flush();

    const restarted = new WriteBehindAgentStore(backend);
    backend.calls.clear();
    await restarted.checkpoints.delete({ filter: { agentIds: ["a1"], blobIds: ["b7"] } });
    await restarted.checkpoints.update({ agentId: "a1", blobId: "b8", data: bytes("newer") });
    for (let i = 0; i < 300; i++) await restarted.checkpoints.get({ agentId: "a1", blobId: `b${i}` });
    expect(backend.calls.get("loadAllBlobs")).toBe(1);
    expect(backend.calls.get("loadBlob") ?? 0).toBe(0);
    expect(await restarted.checkpoints.get({ agentId: "a1", blobId: "b7" })).toBeNull();
    expect(new TextDecoder().decode((await restarted.checkpoints.get({ agentId: "a1", blobId: "b8" }))!)).toBe("newer");
    expect(new TextDecoder().decode((await restarted.checkpoints.get({ agentId: "a1", blobId: "b299" }))!)).toBe("blob 299");
  });

  it("answers writes from memory without touching the backend", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: agent("a1") });
    await store.runs.create({ run: run("a1", "r1") });
    for (let i = 0; i < 200; i++) await store.runEvents.append({ runId: "r1", eventType: "token", payload: { i } });
    await store.checkpoints.create({ agentId: "a1", blobId: "b1", data: bytes("x") });

    expect(backend.agents.size).toBe(0);
    expect(backend.calls.get("saveEvents")).toBeUndefined();
    expect((await store.runEvents.list({ runId: "r1" })).items).toHaveLength(200);
    expect(store.isDirty).toBe(true);
  });

  it("persists everything in one batch per kind on flush", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: agent("a1") });
    await store.runs.create({ run: run("a1", "r1") });
    for (let i = 0; i < 50; i++) await store.runEvents.append({ runId: "r1", eventType: "token" });
    await store.checkpoints.create({ agentId: "a1", blobId: "b1", data: bytes("x") });
    await store.flush();

    expect(backend.agents.get("a1")).toBeTruthy();
    expect(backend.runs.get("r1")).toBeTruthy();
    expect(backend.events.get("r1")).toHaveLength(50);
    expect(backend.blobs.get("a1/b1")).toEqual(bytes("x"));
    expect(backend.calls.get("saveEvents")).toBe(1);
    expect(store.isDirty).toBe(false);
  });

  it("writes blobs before the agent row that points at them", async () => {
    const { backend, store } = setup();
    const order: string[] = [];
    const saveBlobs = backend.saveBlobs.bind(backend);
    const saveAgents = backend.saveAgents.bind(backend);
    backend.saveBlobs = async (b) => (order.push("blobs"), saveBlobs(b));
    backend.saveAgents = async (a) => (order.push("agents"), saveAgents(a));
    await store.agents.create({ agent: agent("a1") });
    await store.checkpoints.create({ agentId: "a1", blobId: "b1", data: bytes("x") });
    await store.flush();
    expect(order).toEqual(["blobs", "agents"]);
  });

  it("keeps data dirty when a flush fails and retries it next time", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: agent("a1") });
    await store.runs.create({ run: run("a1", "r1") });
    await store.runEvents.append({ runId: "r1", eventType: "token" });
    backend.failOnce = "saveRuns";
    await expect(store.flush()).rejects.toThrow("saveRuns failed");
    expect(backend.agents.get("a1")).toBeTruthy();
    expect(backend.runs.get("r1")).toBeUndefined();
    expect(store.isDirty).toBe(true);

    await store.flush();
    expect(backend.runs.get("r1")).toBeTruthy();
    expect(backend.events.get("r1")).toHaveLength(1);
    expect(store.isDirty).toBe(false);
  });

  it("shares one in-flight flush and runs one more pass for late writes", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: agent("a1") });
    const first = store.flush();
    await store.agents.update({ agent: agent("a1", 2) });
    const second = store.flush();
    await Promise.all([first, second]);
    expect(backend.agents.get("a1")?.updatedAt).toBe(2);
    expect(store.isDirty).toBe(false);
  });

  it("resumes a chat on a fresh process from the backend", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: agent("a1") });
    await store.runs.create({ run: run("a1", "r1") });
    await store.runEvents.append({ runId: "r1", eventType: "token" });
    await store.runEvents.append({ runId: "r1", eventType: "token" });
    await store.checkpoints.create({ agentId: "a1", blobId: "b1", data: bytes("state") });
    await store.flush();

    const fresh = new WriteBehindAgentStore(backend);
    expect((await fresh.agents.get({ agentId: "a1" }))?.agentId).toBe("a1");
    expect((await fresh.runs.get({ agentId: "a1", runId: "r1" }))?.runId).toBe("r1");
    expect(await fresh.checkpoints.get({ agentId: "a1", blobId: "b1" })).toEqual(bytes("state"));
    // New events continue the sequence instead of colliding with stored ones.
    const next = await fresh.runEvents.append({ runId: "r1", eventType: "token" });
    expect(next.seq).toBe(3);
    const all = await fresh.runEvents.list({ runId: "r1" });
    expect(all.items.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("lists events after an offset across backend and memory", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: agent("a1") });
    await store.runs.create({ run: run("a1", "r1") });
    for (let i = 0; i < 5; i++) await store.runEvents.append({ runId: "r1", eventType: "e" });
    await store.flush();
    store.evictAgent("a1");
    for (let i = 0; i < 3; i++) await store.runEvents.append({ runId: "r1", eventType: "e" });
    const page = await store.runEvents.list({ runId: "r1", afterOffset: "3", limit: 10 });
    expect(page.items.map((e) => e.seq)).toEqual([4, 5, 6, 7, 8]);
  });

  it("evicts only clean agents", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: agent("a1") });
    store.evictAgent("a1");
    expect(await store.agents.get({ agentId: "a1" })).toBeTruthy();
    expect(backend.calls.get("loadAgent")).toBeUndefined();

    await store.flush();
    store.evictAgent("a1");
    expect(await store.agents.get({ agentId: "a1" })).toBeTruthy();
    expect(backend.calls.get("loadAgent")).toBe(1);
  });

  it("deletes an agent with its runs, events and blobs", async () => {
    const { backend, store } = setup();
    await store.agents.create({ agent: agent("a1") });
    await store.runs.create({ run: run("a1", "r1") });
    await store.runEvents.append({ runId: "r1", eventType: "e" });
    await store.checkpoints.create({ agentId: "a1", blobId: "b1", data: bytes("x") });
    await store.flush();
    await store.agents.delete({ filter: { agentIds: ["a1"] } });

    expect(backend.agents.size).toBe(0);
    expect(backend.runs.size).toBe(0);
    expect(backend.events.size).toBe(0);
    expect(backend.blobs.size).toBe(0);
    expect(await store.agents.get({ agentId: "a1" })).toBeNull();
  });

  it("never deletes the stored checkpoint before its replacement is saved", async () => {
    const { backend, store } = setup();
    const withRoot = (root: string, updatedAt: number): LocalAgentDocument => ({
      ...agent("a1", updatedAt),
      latestCheckpoint: { schemaVersion: 1, rootBlobId: root },
    });
    // Turn 1 is saved: the row points at blob b1.
    await store.checkpoints.create({ agentId: "a1", blobId: "b1", data: bytes("one") });
    await store.agents.create({ agent: withRoot("b1", 1) });
    await store.flush();

    // Turn 2: the SDK writes b2, points the agent at it and prunes b1.
    await store.checkpoints.create({ agentId: "a1", blobId: "b2", data: bytes("two") });
    await store.agents.update({ agent: withRoot("b2", 2) });
    await store.checkpoints.delete({ filter: { agentIds: ["a1"], blobIds: ["b1"] } });
    expect(backend.blobs.has("a1/b1")).toBe(true);

    // The network drops while saving b2: the stored state must still be whole.
    backend.failOnce = "saveBlobs";
    await expect(store.flush()).rejects.toThrow();
    const stored = backend.agents.get("a1")!;
    expect(stored.latestCheckpoint?.rootBlobId).toBe("b1");
    expect(backend.blobs.has("a1/b1")).toBe(true);

    // Once the connection is back, b2 lands, the row moves, and only then b1 goes.
    await store.flush();
    expect(backend.agents.get("a1")?.latestCheckpoint?.rootBlobId).toBe("b2");
    expect(backend.blobs.has("a1/b2")).toBe(true);
    expect(backend.blobs.has("a1/b1")).toBe(false);
    expect(store.isDirty).toBe(false);
  });

  it("treats a pruned blob as gone before the delete reaches the backend", async () => {
    const { store } = setup();
    await store.checkpoints.create({ agentId: "a1", blobId: "b1", data: bytes("x") });
    await store.flush();
    await store.checkpoints.delete({ filter: { agentIds: ["a1"], blobIds: ["b1"] } });
    expect(await store.checkpoints.get({ agentId: "a1", blobId: "b1" })).toBeNull();
    expect((await store.checkpoints.list({ filter: { agentIds: ["a1"] } })).items).toEqual([]);
    // Recreated before the flush: it stays.
    await store.checkpoints.create({ agentId: "a1", blobId: "b1", data: bytes("y") });
    await store.flush();
    expect(await store.checkpoints.get({ agentId: "a1", blobId: "b1" })).toEqual(bytes("y"));
  });

  it("lists runs in turn order with paging", async () => {
    const { store } = setup();
    await store.agents.create({ agent: agent("a1") });
    await store.runs.create({ run: run("a1", "r2", 2) });
    await store.runs.create({ run: run("a1", "r1", 1) });
    await store.runs.create({ run: run("a1", "r3", 3) });
    const first = await store.runs.list({ filter: { agentIds: ["a1"], limit: 2 } });
    expect(first.items.map((r) => r.runId)).toEqual(["r1", "r2"]);
    const second = await store.runs.list({ filter: { agentIds: ["a1"], limit: 2, cursor: first.nextCursor } });
    expect(second.items.map((r) => r.runId)).toEqual(["r3"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("lists agents newest first, merged from memory and backend, filtered by cwd", async () => {
    const { store } = setup();
    await store.agents.create({ agent: agent("a1", 1) });
    await store.agents.create({ agent: agent("a2", 3) });
    await store.agents.create({ agent: agent("x", 9, "/other") });
    await store.flush();
    await store.agents.create({ agent: agent("a3", 2) });
    const page = await store.agents.list({ filter: { cwd: "/w/a" } });
    expect(page.items.map((a) => a.agentId)).toEqual(["a2", "a3", "a1"]);
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { emptyReply, questionCard, reduceReply, replyText } from "../../../src/lib/store-agent/blocks";
import type { StartRunRequest, StoreAgentEvent } from "../../../src/lib/store-agent/protocol";
import { StoreAgentBusyError, StoreAgentRegistry, StoreAgentRun } from "../../src/store-agent/run";

const request = (over: Partial<StartRunRequest> = {}): StartRunRequest => ({
  runId: randomUUID(),
  chatId: randomUUID(),
  workspaceId: "11111111-1111-4111-8111-111111111111",
  userId: randomUUID(),
  message: "hi",
  attachments: [],
  model: { id: "composer-2.5", params: [] },
  mode: "agent",
  autoRun: false,
  autoRunBulk: false,
  billing: { ownerUserId: randomUUID(), remainingCredits: 10 },
  ...over,
});

describe("StoreAgentRun", () => {
  it("replays missed events to a late subscriber, then follows", () => {
    const run = new StoreAgentRun(request());
    run.emit({ type: "text", delta: "a" });
    run.emit({ type: "text", delta: "b" });
    const seen: number[] = [];
    run.subscribe((e) => seen.push(e.seq), 1);
    run.emit({ type: "text", delta: "c" });
    expect(seen).toEqual([2, 3]);
  });

  it("waits for an approval and resolves it once", async () => {
    const run = new StoreAgentRun(request());
    const outcome = run.waitForApproval("ap1");
    expect(run.waitingOnUser).toBe("approval");
    expect(run.decide("ap1", true)).toBe(true);
    expect(run.decide("ap1", true)).toBe(false);
    await expect(outcome).resolves.toBe("approved");
  });

  it("answers questions and rejects everything on cancel", async () => {
    const run = new StoreAgentRun(request());
    const { questionId, answer } = run.ask([
      { id: "q1", text: "Which?", options: ["A", "B"], multiple: false },
      { id: "q2", text: "Colours?", options: ["Red", "Blue", "Green"], multiple: true },
    ]);
    expect(run.answer(questionId, [["B"], ["Red", "Green"]])).toBe(true);
    await expect(answer).resolves.toEqual([["B"], ["Red", "Green"]]);

    const pending = run.waitForApproval("ap2");
    const q = run.ask([{ id: "q1", text: "More?", options: ["Y", "N"], multiple: false }]);
    run.cancel();
    await expect(pending).resolves.toBe("rejected");
    await expect(q.answer).resolves.toBeNull();
    expect(run.signal.aborted).toBe(true);
  });
});

describe("StoreAgentRegistry", () => {
  it("allows one live run per chat and two per workspace", () => {
    const registry = new StoreAgentRegistry();
    const first = registry.create(request({ chatId: "c1" }));
    expect(() => registry.create(request({ chatId: "c1" }))).toThrow(StoreAgentBusyError);
    registry.create(request({ chatId: "c2" }));
    expect(() => registry.create(request({ chatId: "c3" }))).toThrow(/Too many/);
    registry.finish(first.id);
    expect(registry.get(first.id)?.finished).toBe(true);
    expect(registry.forChat("c1")).toBeUndefined();
    registry.create(request({ chatId: "c3" }));
  });
});

describe("reply reducer", () => {
  const events: StoreAgentEvent[] = [
    { type: "thinking", delta: "Let me ", seq: 1 },
    { type: "thinking", delta: "check.", seq: 2 },
    { type: "thinking_done", ms: 800, seq: 3 },
    { type: "todos", items: [{ id: "0", content: "Read", status: "in_progress" }], seq: 4 },
    { type: "tool_start", callId: "t1", tool: "shopify_admin", kind: "store_read", title: "Reading the store", seq: 5 },
    { type: "tool_end", callId: "t1", ok: true, seq: 6 },
    { type: "todos", items: [{ id: "0", content: "Read", status: "completed" }], seq: 7 },
    { type: "text", delta: "You have ", seq: 8 },
    { type: "text", delta: "63 products.", seq: 9 },
    { type: "approval", approvalId: "a1", risk: "write", summary: "Update 1", operations: ["productUpdate"], preview: null, seq: 10 },
    { type: "approval_resolved", approvalId: "a1", status: "rejected", seq: 11 },
    { type: "tool_start", callId: "t2", tool: "webSearch", kind: "web", title: "Searching the web", seq: 12 },
    { type: "done", status: "cancelled", credits: 0.2, seq: 13 },
  ];

  it("builds ordered blocks and closes what was left running", () => {
    const state = events.reduce(reduceReply, emptyReply());
    expect(state.blocks.map((b) => b.type)).toEqual(["thinking", "todos", "tool", "text", "approval", "tool"]);
    expect(state.blocks[0]).toMatchObject({ text: "Let me check.", done: true, ms: 800 });
    expect(state.blocks[1]).toMatchObject({ items: [{ status: "completed" }] });
    expect(state.blocks[4]).toMatchObject({ status: "rejected" });
    expect(state.blocks[5]).toMatchObject({ status: "error", summary: "stopped" });
    expect(replyText(state.blocks)).toBe("You have 63 products.");
    expect(state).toMatchObject({ status: "cancelled", credits: 0.2, lastSeq: 13 });
  });

  it("ignores replayed events it has already applied", () => {
    const once = events.slice(0, 9).reduce(reduceReply, emptyReply());
    const twice = events.slice(0, 9).reduce(reduceReply, once);
    expect(twice).toBe(once);
  });

  it("keeps one card per plan and records a question card's answers", () => {
    const plan = (version: number, seq: number): StoreAgentEvent => ({
      type: "plan",
      planId: "p1",
      title: "Watch sale",
      content: `# Watch sale v${version}`,
      version,
      status: "draft",
      seq,
    });
    const state = [
      { type: "question", questionId: "c1", questions: [{ id: "q1", text: "Discount?", options: ["20%", "30%"], multiple: false }], seq: 1 },
      { type: "question_resolved", questionId: "c1", answers: [["20%"]], seq: 2 },
      plan(1, 3),
      plan(2, 4),
    ].reduce((s, e) => reduceReply(s, e as StoreAgentEvent), emptyReply());
    expect(state.blocks).toEqual([
      { type: "question", questionId: "c1", questions: [{ id: "q1", text: "Discount?", options: ["20%", "30%"], multiple: false }], answers: [["20%"]] },
      { type: "plan", planId: "p1", title: "Watch sale", version: 2 },
    ]);
  });

  it("reads question blocks saved before cards had several questions", () => {
    const legacy = { type: "question", questionId: "old", text: "Which tone?", options: ["Formal", "Friendly"], multiple: false, answers: ["Friendly"] };
    expect(questionCard(legacy as never)).toEqual({
      questions: [{ id: "q1", text: "Which tone?", options: ["Formal", "Friendly"], multiple: false }],
      answers: [["Friendly"]],
    });
  });
});

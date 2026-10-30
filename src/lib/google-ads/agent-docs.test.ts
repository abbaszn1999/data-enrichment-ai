import { describe, expect, it } from "vitest";
import { buildAdCopyDoc, buildAuditDoc, buildBudgetDoc, buildCompetitorDoc, buildExperimentDoc, buildFeedDoc, buildKeywordDoc, buildPlanDoc, buildReportDoc, editDoc, planDocTurn, replyToComment } from "./agent-docs";
import { DEFAULT_PROFILE, reviseDoc, type AgentDoc } from "./docs";
import { rangeFor } from "./metrics";
import { buildDemoAccount } from "./mock-data";
import { applyOps } from "./mutations";
import { validateOps } from "./validation";

const TODAY = "2026-10-23";
const ctx = () => ({ data: buildDemoAccount(TODAY), range: rangeFor("LAST_30_DAYS", TODAY), scope: {}, profile: DEFAULT_PROFILE, memories: [] });

function checklistOps(doc: AgentDoc) {
  return doc.sections.flatMap((s) => s.blocks).flatMap((b) => (b.kind === "checklist" ? b.items : [])).flatMap((i) => i.ops ?? []);
}

describe("documents", () => {
  const builders: [string, (c: ReturnType<typeof ctx>) => AgentDoc][] = [
    ["plan", (c) => buildPlanDoc(c, { occasion: "Ramadan", budget: 5000, goal: "Sales", focus: "Running shoes" })],
    ["report", (c) => buildReportDoc(c)],
    ["audit", (c) => buildAuditDoc(c)],
    ["budget", (c) => buildBudgetDoc(c, 12000)],
    ["keywords", (c) => buildKeywordDoc(c, "trail running shoes")],
    ["adcopy", (c) => buildAdCopyDoc(c, "leggings")],
    ["feed", (c) => buildFeedDoc(c)],
    ["competitors", (c) => buildCompetitorDoc(c)],
    ["experiment", (c) => buildExperimentDoc(c)],
  ];

  it.each(builders)("%s builds and every step applies", (_, build) => {
    const c = ctx();
    const doc = build(c);
    expect(doc.sections.length).toBeGreaterThan(1);
    let data = c.data;
    for (const op of checklistOps(doc)) {
      expect(validateOps(data, [op])).toEqual([]);
      data = applyOps(data, [op]).next;
    }
  });

  it("budget plan spends the requested total", () => {
    const doc = buildBudgetDoc(ctx(), 12000);
    const table = doc.sections[1].blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.length).toBeGreaterThan(3);
  });

  it("plan mode asks questions without a budget, builds with one", () => {
    const ask = planDocTurn("Make me a Ramadan campaign plan", ctx());
    expect(ask?.questions?.length).toBe(3);
    expect(ask?.doc).toBeUndefined();
    const built = planDocTurn('Answers for "Make me a Ramadan campaign plan": Budget: $5,000 · Goal: New customers · Focus: Gym wear', ctx());
    expect(built?.doc?.type).toBe("PLAN");
    expect(built?.doc?.inputs?.budget).toBe(5000);
    expect(built?.team?.length).toBeGreaterThan(1);
  });

  it("edits produce new versions with highlighted sections", () => {
    const c = ctx();
    const doc = buildPlanDoc(c, { occasion: "Ramadan", budget: 5000, goal: "Sales", focus: "Running shoes" });
    const edit = editDoc(doc, "Change the budget to $8,000", c)!;
    expect(edit.note).toContain("$8,000");
    const v2 = reviseDoc(doc, edit.sections, edit.note, "AGENT", edit.extra);
    expect(v2.version).toBe(2);
    expect(v2.changedSectionIds.length).toBeGreaterThan(0);
    expect(v2.inputs?.budget).toBe(8000);
    const week = editDoc(v2, "Put more budget into week 1", c)!;
    expect(week.note).toMatch(/first phase/);
    expect(editDoc(v2, "Make it shorter", c)!.sections.length).toBeLessThan(v2.sections.length);
    expect(editDoc(v2, "Add a competitor section", c)!.sections.length).toBe(v2.sections.length + 2);
  });

  it("routes edits to the open document", () => {
    const c = ctx();
    const doc = buildPlanDoc(c, { occasion: "Ramadan", budget: 5000, goal: "Sales", focus: "Running shoes" });
    const turn = planDocTurn("Make it shorter", { ...c, docs: [doc], activeDocId: doc.id });
    expect(turn?.docUpdate?.docId).toBe(doc.id);
  });

  it("answers comments, editing when asked", () => {
    const c = ctx();
    const doc = buildPlanDoc(c, { occasion: "Ramadan", budget: 5000, goal: "Sales", focus: "Running shoes" });
    const split = doc.sections.find((s) => s.title === "Budget split")!;
    const why = replyToComment(doc, { id: "c1", sectionId: split.id, author: "YOU", text: "Why this split?", at: "", replies: [] }, c);
    expect(why.edit).toBeUndefined();
    expect(why.reply.length).toBeGreaterThan(20);
    const change = replyToComment(doc, { id: "c2", sectionId: split.id, author: "YOU", text: "Make the budget $6,000", at: "", replies: [] }, c);
    expect(change.edit).toBeDefined();
  });

  it("remembers what the user says", () => {
    expect(planDocTurn("Remember that we never discount Glide 3", ctx())?.memory).toBe("we never discount Glide 3");
  });
});

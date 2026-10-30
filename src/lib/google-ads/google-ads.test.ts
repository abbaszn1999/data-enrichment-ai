import { describe, expect, it } from "vitest";
import { STARTER_PROMPTS, planAgentTurn } from "./agent-sim";
import { catalogFix, productsInGroup, segmentRows } from "./analytics";
import { accountBase, adGroupBase, campaignBase, rangeFor } from "./metrics";
import { buildDemoAccount, buildEmptyAccount } from "./mock-data";
import { applyOps, parseKeywordLines, rateAdStrength } from "./mutations";
import { validateOps } from "./validation";

const TODAY = "2026-10-23";
const range = rangeFor("LAST_30_DAYS", TODAY);

describe("metrics", () => {
  it("ad groups add up to their campaign", () => {
    const data = buildDemoAccount(TODAY);
    const campaign = campaignBase(data, "c_running", range);
    const groups = data.adGroups.filter((g) => g.campaignId === "c_running").map((g) => adGroupBase(data, g.id, range));
    expect(groups.reduce((s, g) => s + g.cost, 0)).toBeCloseTo(campaign.cost, 2);
    expect(groups.reduce((s, g) => s + g.conversions, 0)).toBeCloseTo(campaign.conversions, 2);
  });

  it("budget-capped campaigns never spend far above their budget", () => {
    const data = buildDemoAccount(TODAY);
    for (const p of data.daily.c_running) expect(p.cost).toBeLessThanOrEqual(120 * 1.03);
  });
});

describe("applyOps", () => {
  it("undo restores the account exactly", () => {
    const data = buildDemoAccount(TODAY);
    const { next, inverse } = applyOps(data, [
      { kind: "budget.update", budgetId: "b_running", amount: 200 },
      { kind: "status.set", entity: "KEYWORD", ids: ["k9", "k15"], status: "PAUSED" },
      { kind: "negative.create", negatives: [{ id: "nx", text: "free", matchType: "BROAD", level: "CAMPAIGN", parentId: "c_generic" }] },
      { kind: "recommendation.set", ids: ["rec_budget_running"], status: "APPLIED" },
    ]);
    expect(next.budgets.find((b) => b.id === "b_running")?.amount).toBe(200);
    expect(next.account.optimizationScore).toBeGreaterThan(data.account.optimizationScore);
    const { next: restored } = applyOps(next, inverse);
    expect(restored.budgets).toEqual(data.budgets);
    expect(restored.keywords).toEqual(data.keywords);
    expect(restored.negatives).toEqual(data.negatives);
    expect(restored.recommendations).toEqual(data.recommendations);
    expect(restored.account.optimizationScore).toBeCloseTo(data.account.optimizationScore, 6);
  });

  it("raising a limited budget clears the limited flag", () => {
    const data = buildDemoAccount(TODAY);
    const { next } = applyOps(data, [{ kind: "budget.update", budgetId: "b_running", amount: 180 }]);
    expect(next.campaigns.find((c) => c.id === "c_running")?.servingIssues).not.toContain("LIMITED_BY_BUDGET");
  });
});

describe("collections", () => {
  it("generic upsert and remove undo cleanly", () => {
    const data = buildDemoAccount(TODAY);
    const rule = { ...data.rules[0], id: "r_new", name: "New" };
    const { next, inverse } = applyOps(data, [
      { kind: "collection.upsert", collection: "rules", items: [rule, { ...data.rules[1], enabled: false }] },
      { kind: "collection.remove", collection: "contentTargets", ids: ["ct3"] },
      { kind: "account.update", patch: { enhancedConversions: true } },
    ]);
    expect(next.rules).toHaveLength(data.rules.length + 1);
    expect(next.contentTargets.find((t) => t.id === "ct3")).toBeUndefined();
    const { next: back } = applyOps(next, inverse);
    expect([...back.rules].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...data.rules].sort((a, b) => a.id.localeCompare(b.id)));
    expect(back.contentTargets.map((t) => t.id).sort()).toEqual(data.contentTargets.map((t) => t.id).sort());
    expect(back.account.enhancedConversions).toBe(false);
  });
});

describe("analytics", () => {
  it("segments add up to the account total", () => {
    const data = buildDemoAccount(TODAY);
    const total = accountBase(data, range).cost;
    for (const seg of ["device", "hour", "dayOfWeek", "age", "network", "campaignType"] as const) {
      const rows = segmentRows(data, range, seg);
      expect(rows.reduce((s, r) => s + r.base.cost, 0)).toBeCloseTo(total, 0);
    }
  });

  it("product groups partition the products", () => {
    const data = buildDemoAccount(TODAY);
    const top = data.listingGroups.filter((g) => g.parentId === "lg_root");
    const counted = top.reduce((s, g) => s + productsInGroup(data, g.id).length, 0);
    expect(counted).toBe(data.products.length);
  });

  it("catalog fixes clear fixable issues", () => {
    const data = buildDemoAccount(TODAY);
    const fixed = catalogFix(data.products.find((p) => p.id === "sku-pace-m")!);
    expect(fixed.issues).toHaveLength(0);
    expect(fixed.status).toBe("PENDING");
  });
});

describe("validation", () => {
  it("rejects headlines over 30 characters and missing locations", () => {
    const data = buildDemoAccount(TODAY);
    const errors = validateOps(data, [
      { kind: "ad.update", adId: "ad1", patch: { headlines: [{ text: "x".repeat(31) }, { text: "a" }, { text: "b" }] } },
      { kind: "budget.update", budgetId: "b_brand", amount: 0 },
    ]);
    expect(errors.some((e) => e.includes("30 characters"))).toBe(true);
    expect(errors.some((e) => e.includes("at least 1"))).toBe(true);
  });
});

describe("keyword parsing", () => {
  it("reads match type syntax and drops duplicates", () => {
    expect(parseKeywordLines('running shoes\n"trail shoes"\n[gym leggings]\nrunning shoes', "BROAD")).toEqual([
      { text: "running shoes", matchType: "BROAD" },
      { text: "trail shoes", matchType: "PHRASE" },
      { text: "gym leggings", matchType: "EXACT" },
    ]);
  });
});

describe("ad strength", () => {
  it("rewards more unique headlines", () => {
    const few = rateAdStrength(["A", "B", "C"], ["d1", "d2"]);
    const many = rateAdStrength(Array.from({ length: 12 }, (_, i) => `Running headline ${i}`), ["d1", "d2", "d3", "d4"], ["running"]);
    expect(["POOR", "AVERAGE"]).toContain(few);
    expect(["GOOD", "EXCELLENT"]).toContain(many);
  });
});

describe("agent simulation", () => {
  const prompts = [...STARTER_PROMPTS, "Fix my disapproved ads", "Find new keyword ideas", "Pause keywords that don't convert", "Check my conversion tracking", "Create a Performance Max campaign for gym wear in UAE with $80/day",
    "Fix my Merchant Center product issues", "Which products should I stop advertising?", "When do my ads perform best? Adjust my ad schedule",
    "Compare mobile vs desktop and set device bid adjustments", "Which age groups and genders convert best?", "Set up monitoring and alerts for my account",
    "Which Performance Max assets are weak? Replace them", "Find placements that waste budget", "Show my experiments", "What if I increase my budget by 50%?"];

  it.each(prompts)("proposes valid, applicable changes for: %s", (prompt) => {
    const data = buildDemoAccount(TODAY);
    const plan = planAgentTurn(prompt, { data, range, scope: {} });
    expect(plan.reply.length).toBeGreaterThan(20);
    let state = data;
    for (const change of plan.changes) {
      expect(validateOps(state, change.ops)).toEqual([]);
      state = applyOps(state, change.ops).next;
    }
  });

  it("finds wasted spend in the demo account", () => {
    const plan = planAgentTurn("Where am I wasting budget?", { data: buildDemoAccount(TODAY), range, scope: {} });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].ops[0].kind).toBe("negative.create");
  });

  it("parses budget and country when creating a campaign", () => {
    const data = buildDemoAccount(TODAY);
    const plan = planAgentTurn("Create a Search campaign for running shoes in UAE with $45/day", { data, range, scope: {} });
    const op = plan.changes[0].ops[0];
    expect(op.kind).toBe("campaign.create");
    if (op.kind !== "campaign.create") return;
    expect(op.bundle.budget.amount).toBe(45);
    expect(op.bundle.campaign.locations.map((l) => l.name)).toEqual(["United Arab Emirates"]);
    const { next } = applyOps(data, [op]);
    expect(next.campaigns).toHaveLength(data.campaigns.length + 1);
    expect(accountBase(next, range).cost).toBeCloseTo(accountBase(data, range).cost, 2);
  });

  it("offers to build when the account is empty", () => {
    const plan = planAgentTurn("Where am I wasting budget?", { data: buildEmptyAccount(), range, scope: {} });
    expect(plan.changes).toHaveLength(0);
    expect(plan.reply).toContain("doesn't have any campaigns");
  });
});

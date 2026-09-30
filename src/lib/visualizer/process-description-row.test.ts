import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImageGenerationCost } from "@/lib/ai-pricing";

const state = {
  planCalls: 0,
  planError: null as Error | null,
  deductCalls: [] as Array<Record<string, unknown>>,
  deductResult: { success: true } as { success: boolean; error?: string; duplicate?: boolean },
  removed: [] as string[][],
  productCount: 1,
};

const usage = {
  total_input_tokens: 2000,
  total_output_tokens: 1320,
  total_thought_tokens: 200,
  output_tokens_by_modality: [{ modality: "image", tokens: 1120 }],
};
const cost = () => createImageGenerationCost("gemini-3.1-flash-image", "1K", usage, 0, { imageReturned: true });

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/visualizer/log", () => ({ visualizerLog: vi.fn(), visualizerWarn: vi.fn() }));
vi.mock("@/lib/visualizer/credits", () => ({
  deductVisualizerCredits: async (params: Record<string, unknown>) => {
    state.deductCalls.push(params);
    return state.deductResult;
  },
}));
vi.mock("@/lib/visualizer/storage-admin", () => ({
  removeVisualizerPathsAdmin: async (paths: string[]) => {
    state.removed.push(paths);
  },
}));
vi.mock("@/lib/visualizer/references", () => ({
  loadVisualizerReferences: async () => ({
    ordered: [],
    productCount: state.productCount,
    hasLogo: false,
    hasBrandGuide: false,
    counts: { product: state.productCount },
    staleLogo: false,
    staleBrandGuide: false,
  }),
}));
vi.mock("@/lib/visualizer/agents/description-agent", () => {
  class VisualizerPlannerError extends Error {
    costs: unknown[];
    constructor(message: string, costs: unknown[]) {
      super(message);
      this.costs = costs;
    }
  }
  return {
    VisualizerPlannerError,
    planVisualizerContent: async () => {
      state.planCalls += 1;
      if (state.planError) throw state.planError;
      return {
        productIdentity: "shoe",
        description: "<p>[imageplaceholder-1]</p>",
        imagePlaceholders: [{ index: 1, visualBrief: "p", prompt: "p", alt: "a", storagePath: null }],
        notes: undefined,
        costs: [cost()],
        model: "gpt-6.1-sol",
      };
    },
  };
});

import { VisualizerPlannerError } from "@/lib/visualizer/agents/description-agent";
import { processDescriptionRow } from "./process-description-row";
import { parseVisualizerProjectSettings } from "./settings-schema";
import type { VisualizerRow } from "./types";

const settings = parseVisualizerProjectSettings({
  selectedColumns: ["Title", "Image"],
  productImageColumn: "Image",
  images: { tier: "premium" },
});

function baseRow(overrides: Partial<VisualizerRow> = {}): VisualizerRow {
  return {
    id: "r1",
    rowIndex: 0,
    status: "generating",
    originalData: { Title: "Trail shoe", Image: "https://cdn.shop.com/a.jpg" },
    ...overrides,
  };
}

const run = (row: VisualizerRow, extra: Record<string, unknown> = {}) =>
  processDescriptionRow({
    admin: {} as never,
    workspaceId: "w",
    sessionId: "s",
    row,
    settings,
    ownerUserId: "owner",
    actorUserId: "actor",
    runId: "run1",
    ...extra,
  });

describe("processDescriptionRow", () => {
  beforeEach(() => {
    state.planCalls = 0;
    state.planError = null;
    state.deductCalls = [];
    state.deductResult = { success: true };
    state.removed = [];
    state.productCount = 1;
  });

  it("charges the planner once with the tier's image model in the details", async () => {
    const result = await run(baseRow());
    expect(state.deductCalls).toHaveLength(1);
    const call = state.deductCalls[0] as { amount: number; operation: string; details: Record<string, unknown> };
    expect(call.operation).toBe("visualizer_description");
    expect(call.details.idempotencyKey).toBe("run1:visualizer_description:r1");
    expect(call.details).toMatchObject({
      plannerModel: "gpt-6.1-sol",
      imageModel: "gemini-3-pro-image",
      tier: "premium",
      plannerRounds: 1,
    });
    expect(result.row.status).toBe("description_ready");
    expect(result.creditsUsed).toBe(call.amount);
  });

  it("removes images of an earlier run when a new description replaces the page", async () => {
    await run(
      baseRow({
        imagePlaceholders: [{ index: 1, visualBrief: "old", alt: "a", storagePath: "w/s/r1/old.jpg" }],
      })
    );
    expect(state.removed.flat()).toEqual(["w/s/r1/old.jpg"]);
  });

  it("fails without a charge when the planner fails, but records the billed rounds", async () => {
    state.planError = new VisualizerPlannerError("Planner returned 1 usable image prompts; expected 2", [cost(), cost()]);
    const result = await run(baseRow());
    expect(state.deductCalls).toHaveLength(0);
    expect(result.row.status).toBe("failed");
    expect(result.creditsUsed).toBe(0);
    expect(result.cost).toBeGreaterThan(cost().totalCost);
  });

  it("does not call the planner when the product image cannot be loaded", async () => {
    state.productCount = 0;
    const result = await run(baseRow());
    expect(state.planCalls).toBe(0);
    expect(result.row.status).toBe("failed");
    expect(result.error).toContain("product image");
  });

  it("fails the row and keeps no description when the charge is refused", async () => {
    state.deductResult = { success: false, error: "INSUFFICIENT_CREDITS" };
    const result = await run(baseRow());
    expect(result.row.status).toBe("failed");
    expect(result.row.generatedDescription).toBeUndefined();
    expect(result.creditsUsed).toBe(0);
  });

  it("does not start when the time budget is spent", async () => {
    const result = await run(baseRow(), { deadlineAt: Date.now() + 1_000 });
    expect(state.planCalls).toBe(0);
    expect(result.row.status).toBe("failed");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeminiMarketResearch } from "./gemini-runner";
import type { GeminiRunOptions, GeminiRunResult } from "./gemini-runner";
import type { StoreCollectionItem } from "./store-catalog";

vi.mock("./gemini-runner", () => ({
  runGeminiMarketResearch: vi.fn(),
}));

function makeResult<T>(data: T): GeminiRunResult<T> {
  return {
    data,
    rawText: "",
    cost: {} as GeminiRunResult<unknown>["cost"],
    credits: 0,
    model: "gemini-3.8-flash",
    thinkingLevel: "high",
  };
}

function col(id: string, name: string, productCount: number): StoreCollectionItem {
  return {
    id,
    name,
    handle: id,
    description: "",
    productCount,
    plpPath: `/${id}`,
  } as StoreCollectionItem;
}

describe("runStage1NicheDiscovery (taxonomy orchestration)", () => {
  afterEach(() => {
    vi.mocked(runGeminiMarketResearch).mockReset();
    delete process.env.GEMINI_API_KEY;
  });

  it("builds a full taxonomy tree from a single Pass A call and a single Pass B batch", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { runStage1NicheDiscovery } = await import("./stage1-niche-discovery");

    vi.mocked(runGeminiMarketResearch).mockImplementation(
      async (opts: GeminiRunOptions): Promise<GeminiRunResult<unknown>> => {
        if (opts.userPrompt.includes("Propose the full category")) {
          return makeResult({
            categories: [
              {
                id: "womens-clothing",
                name: "Women's Clothing",
                subcategories: [{ id: "dresses", name: "Dresses" }],
              },
            ],
            agentConclusion: "Organized into 1 category.",
          });
        }
        return makeResult({
          assignments: [
            { itemId: "c1", subcategoryId: "dresses", primary: true },
            { itemId: "c2", subcategoryId: "dresses", primary: true },
          ],
          excluded: [],
        });
      }
    );

    const result = await runStage1NicheDiscovery({
      storeName: "Test Store",
      collections: [col("c1", "Dresses", 620), col("c2", "Long Dresses", 240)],
    });

    expect(result.isAiGenerated).toBe(true);
    expect(result.taxonomy?.categories).toHaveLength(1);
    expect(result.taxonomy?.totalUniqueProducts).toBe(860);
    expect(result.structuredNiches).toHaveLength(1);
    expect(result.structuredNiches[0].productCount).toBe(860);
  });

  it("retries only the ids a Pass B batch actually missed, not the whole batch", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { runStage1NicheDiscovery } = await import("./stage1-niche-discovery");

    const passBCallPayloads: string[][] = [];

    vi.mocked(runGeminiMarketResearch).mockImplementation(
      async (opts: GeminiRunOptions): Promise<GeminiRunResult<unknown>> => {
        if (opts.userPrompt.includes("Propose the full category")) {
          return makeResult({
            categories: [
              { id: "cat", name: "Category", subcategories: [{ id: "sub", name: "Sub" }] },
            ],
            agentConclusion: "ok",
          });
        }

        const parsed = JSON.parse(
          opts.userPrompt.split("Candidates to place")[1]!.replace(/^[^:]*:\s*/, "")
        ) as Array<{ id: string }>;
        const ids = parsed.map((c) => c.id);
        passBCallPayloads.push(ids);

        // First call (3 ids) omits "c2"; the retry call should contain only "c2".
        const isFirstCall = ids.length === 3;
        const omit = isFirstCall ? new Set(["c2"]) : new Set<string>();

        return makeResult({
          assignments: ids
            .filter((id) => !omit.has(id))
            .map((id) => ({ itemId: id, subcategoryId: "sub", primary: true })),
          excluded: [],
        });
      }
    );

    const result = await runStage1NicheDiscovery({
      storeName: "Test Store",
      collections: [col("c1", "A", 10), col("c2", "B", 20), col("c3", "C", 30)],
    });

    expect(passBCallPayloads).toHaveLength(2);
    expect(passBCallPayloads[0]).toEqual(["c1", "c2", "c3"]);
    expect(passBCallPayloads[1]).toEqual(["c2"]);
    expect(result.taxonomy?.excluded).toHaveLength(0);
    expect(result.taxonomy?.totalUniqueProducts).toBe(60);
  });

  it("routes ids still missing after the retry budget to excluded/unresolved instead of dropping them", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { runStage1NicheDiscovery } = await import("./stage1-niche-discovery");

    vi.mocked(runGeminiMarketResearch).mockImplementation(
      async (opts: GeminiRunOptions): Promise<GeminiRunResult<unknown>> => {
        if (opts.userPrompt.includes("Propose the full category")) {
          return makeResult({
            categories: [
              { id: "cat", name: "Category", subcategories: [{ id: "sub", name: "Sub" }] },
            ],
            agentConclusion: "ok",
          });
        }

        const parsed = JSON.parse(
          opts.userPrompt.split("Candidates to place")[1]!.replace(/^[^:]*:\s*/, "")
        ) as Array<{ id: string }>;
        const ids = parsed.map((c) => c.id);
        // "c2" is never placed, no matter how many times it's retried — only
        // whatever real ids were actually in this call's batch get an answer.
        return makeResult({
          assignments: ids
            .filter((id) => id !== "c2")
            .map((id) => ({ itemId: id, subcategoryId: "sub", primary: true })),
          excluded: [],
        });
      }
    );

    const result = await runStage1NicheDiscovery({
      storeName: "Test Store",
      collections: [col("c1", "A", 10), col("c2", "B", 20)],
    });

    expect(result.taxonomy?.excluded).toEqual([
      { itemId: "c2", name: "B", reason: "unresolved" },
    ]);
    // "c2" never contributes to any total once it's routed to excluded.
    expect(result.taxonomy?.totalUniqueProducts).toBe(10);
  });

  it("falls back to the heuristic path when Pass A itself fails", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const { runStage1NicheDiscovery } = await import("./stage1-niche-discovery");

    vi.mocked(runGeminiMarketResearch).mockRejectedValue(new Error("simulated Pass A failure"));

    const result = await runStage1NicheDiscovery({
      storeName: "Test Store",
      collections: [col("c1", "Dresses", 620)],
    });

    expect(result.isAiGenerated).toBe(false);
    expect(result.taxonomy).toBeUndefined();
    expect(result.structuredNiches.length).toBeGreaterThan(0);
  });

  it("falls back to the heuristic path when there is no Gemini API key", async () => {
    delete process.env.GEMINI_API_KEY;
    const { runStage1NicheDiscovery } = await import("./stage1-niche-discovery");

    const result = await runStage1NicheDiscovery({
      storeName: "Test Store",
      collections: [col("c1", "Dresses", 620)],
    });

    expect(result.isAiGenerated).toBe(false);
    expect(runGeminiMarketResearch).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createSearchApiCost, calculateOpenAiWebSearchCost, sumCosts } from "@/lib/ai-pricing";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import {
  EnrichBilledAttemptError,
  EnrichCancelledError,
  EnrichProviderUnavailableError,
} from "../openai";
import {
  IMAGE_FINDER_TIER_BUDGET_MS,
  IMAGE_FINDER_TIER_ORDER,
  findProductImagesAuto,
  type ImageFinderTier,
} from "./pipeline";

const openAi = (tokens = 1_000) =>
  calculateOpenAiWebSearchCost("gpt-6.1-sol", { input_tokens: tokens, output_tokens: tokens / 2 }, 1);
const searchApi = () => createSearchApiCost(1);

const image = (n: number) => ({ imageUrl: `https://cdn.test/${n}.jpg`, pageUrl: `https://shop.test/p/${n}`, title: "Product image" });

function foundResult(tier: string, pages: string[] = ["https://shop.test/p/1"]): EnrichAgentResult {
  return {
    data: {
      imageUrls: pages.map((pageUrl, i) => ({ imageUrl: `https://cdn.test/${tier}-${i}.jpg`, pageUrl, title: "Product image" })),
      imageUrls__notFoundReason: "",
      imageUrls__matchBasis: tier,
      imageUrls__matchNote: `${tier} note`,
    },
    costs: [openAi()],
  };
}
const missResult = (note: string, costs = [openAi()]): EnrichAgentResult => ({
  data: { imageUrls: [], imageUrls__notFoundReason: note, imageUrls__matchBasis: "", imageUrls__matchNote: "" },
  costs,
});

const params = { productData: { Code: "X-1" }, enabledColumns: ["imageUrls"] } as EnrichAgentParams;

function runners(map: Partial<Record<ImageFinderTier, () => Promise<EnrichAgentResult>>>) {
  const calls: ImageFinderTier[] = [];
  const wrapped: Partial<Record<ImageFinderTier, (p: EnrichAgentParams) => Promise<EnrichAgentResult>>> = {};
  for (const tier of IMAGE_FINDER_TIER_ORDER) {
    wrapped[tier] = async () => {
      calls.push(tier);
      const run = map[tier];
      if (!run) throw new Error(`unexpected call to ${tier}`);
      return run();
    };
  }
  return { calls, runners: wrapped };
}

describe("findProductImagesAuto", () => {
  it("runs Standard, then Exact, then Premium", () => {
    expect([...IMAGE_FINDER_TIER_ORDER]).toEqual(["standard", "exact", "premium"]);
  });

  it("stops at the first tier that returns images, even a weak one", async () => {
    const { calls, runners: r } = runners({ standard: async () => foundResult("standard") });
    const result = await findProductImagesAuto(params, { runners: r });

    expect(calls).toEqual(["standard"]);
    expect(result.data.imageUrls__foundBy).toBe("standard");
    expect(result.meta).toEqual({ tiersRun: ["standard"], foundBy: "standard" });
    expect(result.costs).toHaveLength(1);
  });

  it("moves on only when a tier returned zero images, and sums the cost of every tier", async () => {
    const exactCosts = [searchApi(), searchApi(), openAi(2_000)];
    const standardCosts = [openAi(3_000)];
    const { calls, runners: r } = runners({
      standard: async () => missResult("nothing on the fast search", standardCosts),
      exact: async () => ({ ...foundResult("exact"), costs: exactCosts }),
    });
    const result = await findProductImagesAuto(params, { runners: r });

    expect(calls).toEqual(["standard", "exact"]);
    expect(result.data.imageUrls__foundBy).toBe("exact");
    expect(result.data.imageUrls__matchBasis).toBe("exact");
    expect(result.costs).toEqual([...standardCosts, ...exactCosts]);
    const summed = sumCosts(result.costs);
    expect(summed.breakdown.searchApiCalls).toBe(2);
    expect(summed.totalCost).toBeCloseTo(sumCosts(standardCosts).totalCost + sumCosts(exactCosts).totalCost, 12);
  });

  it("reports Not found only after every tier failed, with a note per tier and all costs", async () => {
    const { calls, runners: r } = runners({
      standard: async () => missResult("no page shows the code"),
      exact: async () => missResult("Google AI Mode found no exact-match product page", [searchApi(), searchApi()]),
      premium: async () => missResult("checked five shops"),
    });
    const result = await findProductImagesAuto(params, { runners: r });

    expect(calls).toEqual(["standard", "exact", "premium"]);
    expect(result.data.imageUrls).toEqual([]);
    expect(result.data.imageUrls__notFoundReason).toBe(
      "Standard: no page shows the code; Exact: Google AI Mode found no exact-match product page; Premium: checked five shops"
    );
    expect(result.data.imageUrls__foundBy).toBe("");
    expect(result.data.imageSourceUrls).toEqual([]);
    expect(result.costs).toHaveLength(4);
    expect(result.meta).toEqual({ tiersRun: ["standard", "exact", "premium"] });
  });

  it("fills the Image sources column from the kept images' pages, best first, without repeats", async () => {
    const { runners: r } = runners({
      standard: async () =>
        foundResult("standard", ["https://www.shop.test/p/1", "https://other.test/item?id=9", "https://shop.test/p/1/", "javascript:alert(1)"]),
    });
    const result = await findProductImagesAuto(params, { runners: r });
    expect(result.data.imageSourceUrls).toEqual([
      { title: "shop.test", uri: "https://www.shop.test/p/1" },
      { title: "other.test", uri: "https://other.test/item?id=9" },
    ]);
  });

  it("a tier that errors does not end the chain, and its billed cost is still charged", async () => {
    const billed = [searchApi()];
    const { calls, runners: r } = runners({
      standard: async () => {
        throw new EnrichBilledAttemptError("OpenAI ended with status incomplete", [openAi(4_000)]);
      },
      exact: async () => {
        throw new EnrichBilledAttemptError("Exact broke", billed);
      },
      premium: async () => foundResult("premium"),
    });
    const result = await findProductImagesAuto(params, { runners: r });

    expect(calls).toEqual(["standard", "exact", "premium"]);
    expect(result.data.imageUrls__foundBy).toBe("premium");
    expect(result.costs).toHaveLength(3);
  });

  it("never reports a false Not found: with an errored tier and no images it throws, carrying every cost", async () => {
    const { runners: r } = runners({
      standard: async () => missResult("nothing"),
      exact: async () => {
        throw new EnrichBilledAttemptError("SearchApi down", [searchApi()]);
      },
      premium: async () => missResult("nothing either"),
    });
    await expect(findProductImagesAuto(params, { runners: r })).rejects.toMatchObject({
      name: "EnrichBilledAttemptError",
      message: expect.stringContaining("Exact: failed (SearchApi down)"),
      costs: [expect.anything(), expect.anything(), expect.anything()],
    });
  });

  it("a cancel ends the row at once and carries the costs so far", async () => {
    const { calls, runners: r } = runners({
      standard: async () => missResult("nothing"),
      exact: async () => {
        throw new EnrichCancelledError("Cancelled by user", [searchApi()]);
      },
    });
    await expect(findProductImagesAuto(params, { runners: r })).rejects.toMatchObject({
      name: "EnrichCancelledError",
      costs: [expect.anything(), expect.anything()],
    });
    expect(calls).toEqual(["standard", "exact"]);
  });

  it("checks for a stop between tiers and starts nothing after it", async () => {
    const shouldCancel = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { calls, runners: r } = runners({ standard: async () => missResult("nothing") });
    await expect(findProductImagesAuto({ ...params, shouldCancel }, { runners: r })).rejects.toMatchObject({
      name: "EnrichCancelledError",
      costs: [expect.anything()],
    });
    expect(calls).toEqual(["standard"]);
  });

  it("an out-of-quota AI account ends the row at once with its costs", async () => {
    const { calls, runners: r } = runners({
      standard: async () => {
        throw new EnrichProviderUnavailableError("quota", [openAi()]);
      },
    });
    await expect(findProductImagesAuto(params, { runners: r })).rejects.toMatchObject({
      name: "EnrichProviderUnavailableError",
      costs: [expect.anything()],
    });
    expect(calls).toEqual(["standard"]);
  });

  it("skips a tier that no longer fits the row deadline and reports the row as unfinished, not Not found", async () => {
    let clock = 0;
    const { calls, runners: r } = runners({
      standard: async () => {
        clock += 1_800_000;
        return missResult("nothing");
      },
    });
    await expect(
      findProductImagesAuto(params, { runners: r, now: () => clock, chainBudgetMs: 2_100_000 })
    ).rejects.toMatchObject({ message: expect.stringContaining("skipped, not enough time") });
    expect(calls).toEqual(["standard"]);
    expect(IMAGE_FINDER_TIER_BUDGET_MS.exact).toBeGreaterThan(300_000);
  });

  it("the final re-check runs Premium alone", async () => {
    const { calls, runners: r } = runners({ premium: async () => foundResult("premium") });
    const result = await findProductImagesAuto({ ...params, recheck: true, learnedDomains: ["shop.test"] }, { runners: r });
    expect(calls).toEqual(["premium"]);
    expect(result.data.imageUrls__foundBy).toBe("premium");
  });

  it("passes the same params, learned websites included, to every tier", async () => {
    const seen: EnrichAgentParams[] = [];
    const tier = (name: string) => async (p: EnrichAgentParams) => {
      seen.push(p);
      return name === "premium" ? foundResult("premium") : missResult("nothing");
    };
    await findProductImagesAuto(
      { ...params, learnedDomains: ["shop.test"] },
      { runners: { standard: tier("standard"), exact: tier("exact"), premium: tier("premium") } }
    );
    expect(seen).toHaveLength(3);
    expect(seen.every((p) => p.learnedDomains?.[0] === "shop.test")).toBe(true);
  });

  it("returns the winning tier's own images untouched", async () => {
    const { runners: r } = runners({
      standard: async () => ({
        data: { imageUrls: [image(1), image(2)], imageUrls__notFoundReason: "stale" },
        costs: [openAi()],
      }),
    });
    const result = await findProductImagesAuto(params, { runners: r });
    expect(result.data.imageUrls).toEqual([image(1), image(2)]);
    expect(result.data.imageUrls__notFoundReason).toBe("");
  });
});

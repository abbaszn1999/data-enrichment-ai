import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchApiCost } from "@/lib/ai-pricing";
import { billedCostsOf, EnrichBilledAttemptError, EnrichCancelledError } from "./openai";
import type { EnrichAgentParams } from "./types";

const findSourceUrls = vi.hoisted(() => vi.fn());

vi.mock("./source-urls/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./source-urls/agent")>()),
  findSourceUrls,
}));

const { enrichRow } = await import("./agent");

const params = (memo?: EnrichAgentParams["sourceUrlsMemo"]): EnrichAgentParams => ({
  productData: { Barcode: "111" },
  enabledColumns: ["sourceUrls"],
  enrichmentColumns: [{ id: "sourceUrls", label: "Source URLs", description: "", type: "sourceUrls", enabled: true }],
  settings: { enrichmentModel: "standard", outputLanguage: "English" },
  kind: "product",
  ...(memo ? { sourceUrlsMemo: memo } : {}),
});

const found = { data: { sourceUrls: [{ title: "Shop", uri: "https://shop.example.com/p/1" }] }, costs: [createSearchApiCost(1)] };

describe("a row's Source URLs search runs at most once, however often the row is attempted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does not search again, and bills nothing more, after a search that failed having billed", async () => {
    const billed = new EnrichBilledAttemptError("search broke", [createSearchApiCost(1), createSearchApiCost(1)]);
    findSourceUrls.mockRejectedValueOnce(billed);
    const memo = {};

    const first = await enrichRow(params(memo)).catch((e: unknown) => e);
    expect(billedCostsOf(first)).toHaveLength(2);

    // The row's second attempt: no new search (so no new charge) and the same failure.
    const second = await enrichRow(params(memo)).catch((e: unknown) => e);
    expect(findSourceUrls).toHaveBeenCalledTimes(1);
    expect((second as Error).message).toBe("search broke");
    expect(billedCostsOf(second)).toHaveLength(0);
  });

  it("tries again after a failure that billed nothing", async () => {
    findSourceUrls.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(found);
    const memo = {};
    await expect(enrichRow(params(memo))).rejects.toThrow("network down");
    const second = await enrichRow(params(memo));
    expect(findSourceUrls).toHaveBeenCalledTimes(2);
    expect(second.costs).toHaveLength(1);
  });

  it("reuses a search that answered without charging it a second time", async () => {
    findSourceUrls.mockResolvedValueOnce(found);
    const memo = {};
    const first = await enrichRow(params(memo));
    const second = await enrichRow(params(memo));
    expect(findSourceUrls).toHaveBeenCalledTimes(1);
    expect(first.costs).toHaveLength(1);
    expect(second.costs).toEqual([]);
    expect(second.data).toEqual(first.data);
  });

  it("does not remember a stop as a failure", async () => {
    findSourceUrls.mockRejectedValueOnce(new EnrichCancelledError("stopped", [createSearchApiCost(1)]));
    const memo: NonNullable<EnrichAgentParams["sourceUrlsMemo"]> = {};
    await expect(enrichRow(params(memo))).rejects.toBeInstanceOf(EnrichCancelledError);
    expect(memo.failure).toBeUndefined();
  });

  it("works without a memo", async () => {
    findSourceUrls.mockResolvedValue(found);
    await enrichRow(params());
    await enrichRow(params());
    expect(findSourceUrls).toHaveBeenCalledTimes(2);
  });
});

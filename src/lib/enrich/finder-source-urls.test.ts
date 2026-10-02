import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchApiCost, createSerperCost } from "@/lib/ai-pricing";
import { EnrichBilledAttemptError, EnrichCancelledError } from "./openai";
import { enrichRow } from "./agent";
import { findProductImages } from "./image-finder/agent";
import { findSourceUrls } from "./source-urls/agent";

// The two agents themselves are covered by their own tests; here only how a
// "Source & Image Finder" run combines them.
vi.mock("./image-finder/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./image-finder/agent")>()),
  findProductImages: vi.fn(),
}));
vi.mock("./source-urls/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./source-urls/agent")>()),
  findSourceUrls: vi.fn(),
}));

const imagesMock = vi.mocked(findProductImages);
const sourcesMock = vi.mocked(findSourceUrls);

// Any billed cost will do for the image side: the test only checks that costs are kept and merged.
const imageCost = createSerperCost(3);
const googleCost = createSearchApiCost(1);

const imagesResult = {
  data: {
    imageUrls: [{ url: "https://cdn.acme.com/wx-1.jpg", pageUrl: "https://acme.com/wx-1", title: "Widget" }],
    imageSourceUrls: [{ title: "Widget", uri: "https://acme.com/wx-1" }],
  },
  costs: [imageCost],
  meta: { tiersRun: ["standard"], foundBy: "standard" },
};
const sourcesResult = {
  data: { sourceUrls: [{ title: "Acme", uri: "https://acme.com/wx-1" }], sourceUrls__notFoundReason: "" },
  costs: [googleCost],
};

const base = {
  productData: { Title: "Widget WX-1" },
  kind: "product" as const,
};
const finderColumns = ["imageUrls", "imageSourceUrls"];

describe("Source & Image Finder run: Images and Source URLs together", () => {
  beforeEach(() => {
    imagesMock.mockReset();
    sourcesMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs both agents and keeps both answers and both costs", async () => {
    imagesMock.mockResolvedValue(imagesResult);
    sourcesMock.mockResolvedValue(sourcesResult);

    const result = await enrichRow({ ...base, enabledColumns: [...finderColumns, "sourceUrls"] });

    expect(imagesMock).toHaveBeenCalledTimes(1);
    expect(sourcesMock).toHaveBeenCalledTimes(1);
    expect(result.data.imageUrls).toHaveLength(1);
    expect(result.data.imageSourceUrls).toHaveLength(1);
    expect(result.data.sourceUrls).toHaveLength(1);
    expect(result.costs).toEqual([imageCost, googleCost]);
    // The Image Finder's tier record stays with the row's charge details.
    expect(result.meta).toEqual({ tiersRun: ["standard"], foundBy: "standard" });
  });

  it("Images alone makes no Google search", async () => {
    imagesMock.mockResolvedValue(imagesResult);
    const result = await enrichRow({ ...base, enabledColumns: finderColumns });
    expect(sourcesMock).not.toHaveBeenCalled();
    expect(result.costs).toEqual([imageCost]);
  });

  it("Source URLs alone makes no image search", async () => {
    sourcesMock.mockResolvedValue(sourcesResult);
    const result = await enrichRow({ ...base, enabledColumns: ["sourceUrls"] });
    expect(imagesMock).not.toHaveBeenCalled();
    expect(result.data.sourceUrls).toHaveLength(1);
  });

  it("the final re-check of Not-found rows only re-runs the image search", async () => {
    imagesMock.mockResolvedValue(imagesResult);
    await enrichRow({ ...base, enabledColumns: [...finderColumns, "sourceUrls"], recheck: true });
    expect(imagesMock).toHaveBeenCalledTimes(1);
    expect(sourcesMock).not.toHaveBeenCalled();
  });

  it("a failed Google search keeps the images and says why Source URLs is empty", async () => {
    imagesMock.mockResolvedValue(imagesResult);
    sourcesMock.mockRejectedValue(new EnrichBilledAttemptError("SearchApi down", [googleCost]));

    const result = await enrichRow({ ...base, enabledColumns: [...finderColumns, "sourceUrls"] });

    expect(result.data.imageUrls).toHaveLength(1);
    expect(result.data.sourceUrls).toEqual([]);
    expect(String(result.data["sourceUrls__notFoundReason"])).toMatch(/Run this column again/);
    expect(result.costs).toEqual([imageCost, googleCost]);
  });

  it("a failed image search fails the row but still charges what Google billed", async () => {
    imagesMock.mockRejectedValue(new EnrichBilledAttemptError("tiers failed", [imageCost]));
    sourcesMock.mockResolvedValue(sourcesResult);

    const error = await enrichRow({ ...base, enabledColumns: [...finderColumns, "sourceUrls"] }).catch((e) => e);

    expect(error).toBeInstanceOf(EnrichBilledAttemptError);
    expect((error as EnrichBilledAttemptError).costs).toEqual([imageCost, googleCost]);
  });

  it("Stop ends the row, charged for what both agents billed", async () => {
    imagesMock.mockResolvedValue(imagesResult);
    sourcesMock.mockRejectedValue(new EnrichCancelledError("Cancelled by user", [googleCost]));

    const error = await enrichRow({ ...base, enabledColumns: [...finderColumns, "sourceUrls"] }).catch((e) => e);

    expect(error).toBeInstanceOf(EnrichCancelledError);
    expect((error as EnrichCancelledError).costs).toEqual([googleCost, imageCost]);
  });
});

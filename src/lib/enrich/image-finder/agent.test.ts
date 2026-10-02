import { describe, expect, it, vi } from "vitest";
import { createSearchApiCost } from "@/lib/ai-pricing";
import { EnrichBilledAttemptError, EnrichCancelledError } from "../openai";
import type { EnrichAgentParams, EnrichAgentResult } from "../types";
import { findProductImages, isImageFinderRun } from "./agent";

const params: EnrichAgentParams = {
  productData: { Code: "RCP1151426", Description: "RC vehicle" },
  enabledColumns: ["imageUrls"],
  kind: "product",
};

const cost = createSearchApiCost(1);
const image = { imageUrl: "https://shop.test/a.jpg", pageUrl: "https://shop.test/p/a", title: "Product image" };

function result(data: Record<string, unknown>): EnrichAgentResult {
  return { data, costs: [cost] };
}

describe("findProductImages", () => {
  it("runs the agent once and fills the image sources and the found-by label", async () => {
    const run = vi.fn(async () => result({ imageUrls: [image], imageUrls__notFoundReason: "stale" }));
    const out = await findProductImages(params, run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(out.data.imageUrls).toEqual([image]);
    expect(out.data.imageSourceUrls).toEqual([{ uri: "https://shop.test/p/a", title: "shop.test" }]);
    expect(out.data.imageUrls__notFoundReason).toBe("");
    expect(out.data.imageUrls__foundBy).toBe("standard");
    expect(out.meta).toEqual({ tiersRun: ["standard"], foundBy: "standard" });
    expect(out.costs).toEqual([cost]);
  });

  it("reports Not found with the agent's reason and clears every sibling value", async () => {
    const run = vi.fn(async () =>
      result({ imageUrls: [], imageUrls__notFoundReason: "No page shows RCP1151426.", imageUrls__matchBasis: "standard" })
    );
    const out = await findProductImages(params, run);

    expect(out.data).toEqual({
      imageUrls: [],
      imageSourceUrls: [],
      imageUrls__notFoundReason: "No page shows RCP1151426.",
      imageUrls__matchBasis: "",
      imageUrls__matchNote: "",
      imageUrls__foundBy: "",
    });
    expect(out.meta).toEqual({ tiersRun: ["standard"] });
  });

  it("gives a reason when the agent returned none", async () => {
    const out = await findProductImages(params, async () => result({ imageUrls: [] }));
    expect(String(out.data.imageUrls__notFoundReason)).toMatch(/No images were found/);
  });

  it("passes a re-check, known pages and the learned websites to the agent unchanged", async () => {
    const run = vi.fn(async (_: EnrichAgentParams) => result({ imageUrls: [image] }));
    const given = { ...params, recheck: true, learnedDomains: ["shop.test"], knownPages: [{ url: "https://shop.test/p/a" }] };
    await findProductImages(given, run);
    expect(run).toHaveBeenCalledWith(given);
  });

  it("lets a failed call throw with the costs it billed, never as a false Not found", async () => {
    const run = vi.fn(async () => {
      throw new EnrichBilledAttemptError("OpenAI is busy", [cost]);
    });
    await expect(findProductImages(params, run)).rejects.toMatchObject({ costs: [cost] });
  });

  it("stops before calling the agent when the row was cancelled", async () => {
    const run = vi.fn(async () => result({ imageUrls: [image] }));
    await expect(findProductImages({ ...params, shouldCancel: async () => true }, run)).rejects.toBeInstanceOf(
      EnrichCancelledError
    );
    expect(run).not.toHaveBeenCalled();
  });
});

describe("isImageFinderRun", () => {
  it("is an Image Finder run for images, alone or with Image sources and Source URLs", () => {
    expect(isImageFinderRun("product", ["imageUrls"])).toBe(true);
    expect(isImageFinderRun("product", ["imageUrls", "imageSourceUrls", "sourceUrls"])).toBe(true);
    expect(isImageFinderRun("product", ["sourceUrls"])).toBe(false);
    expect(isImageFinderRun("product", ["imageUrls", "titleTag"])).toBe(false);
    expect(isImageFinderRun("plp", ["imageUrls"])).toBe(false);
  });
});

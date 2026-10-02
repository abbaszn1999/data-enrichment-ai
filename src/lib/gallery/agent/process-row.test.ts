import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiCallCost } from "@/lib/ai-pricing";
import { calculateOpenAiWebSearchCost, sumCosts } from "@/lib/ai-pricing";
import { EnrichBilledAttemptError } from "@/lib/enrich/openai";
import { createEmptyWorksheet } from "@/lib/gallery/types";

const research = vi.hoisted(() => ({ researchGalleryImages: vi.fn() }));
vi.mock("@/lib/gallery/agents/gallery-research-agent", () => research);
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/workspace-context", () => ({ updateCachedCredits: vi.fn() }));
vi.mock("@/lib/gallery/storage-assets", () => ({ removeGalleryAssets: vi.fn(async () => undefined) }));
vi.mock("@/lib/gallery/storage-admin", () => ({ downloadGalleryBytesAdmin: vi.fn(async () => null) }));

import { processScrapingRow } from "./process-row";

function round(input: number, cached: number, output: number, searches: number): AiCallCost {
  return calculateOpenAiWebSearchCost(
    "gpt-6.1-sol",
    { input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: output },
    searches
  );
}

function setup() {
  const worksheet = createEmptyWorksheet("s1", ["Title", "Image"], [
    { id: "r1", rowIndex: 0, originalData: { Title: "Acme Shoe", Image: "https://cdn.shop.com/main.jpg" } },
  ]);
  worksheet.originalImageColumn = "Image";
  worksheet.settings.scraping.imagesPerRow = 2;
  const rpc = vi.fn(async (): Promise<{ data: Record<string, unknown>; error: null }> => ({
    data: { success: true, remaining: 100 },
    error: null,
  }));
  const admin = { rpc } as never;
  const params = {
    admin,
    workspaceId: "w1",
    sessionId: "s1",
    worksheet,
    row: worksheet.rows[0]!,
    ownerUserId: "u1",
    actorUserId: "u1",
    runId: "run1",
  };
  return { rpc, params };
}

beforeEach(() => {
  research.researchGalleryImages.mockReset();
});

describe("processScrapingRow billing", () => {
  it("charges the summed cost of every research round, once, with an idempotency key", async () => {
    const costs = [round(9_000, 0, 900, 1), round(14_000, 8_000, 900, 1), round(19_000, 13_000, 1_500, 0)];
    research.researchGalleryImages.mockResolvedValue({
      productIdentity: "Acme Shoe",
      images: [
        { imageUrl: "https://cdn.brand.com/back.jpg", pageUrl: "https://brand.com/p", perspective: "back", title: "Gallery · back" },
        { imageUrl: "https://cdn.brand.com/side.jpg", pageUrl: "https://brand.com/p", perspective: "side", title: "Gallery · side" },
      ],
      costs,
      searchCallCount: 2,
      stats: { pagesOpened: 4 },
      rejections: [],
      unverifiedNote: "",
    });
    const { rpc, params } = setup();
    const result = await processScrapingRow(params);

    const expectedCredits = sumCosts(costs).totalCredits;
    expect(result.row.status).toBe("ready");
    expect(result.row.galleryImagePaths).toHaveLength(2);
    expect(result.creditsUsed).toBeCloseTo(expectedCredits, 6);
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(args.p_amount).toBeCloseTo(expectedCredits, 6);
    const details = args.p_details as Record<string, unknown>;
    expect(details.idempotencyKey).toBe("run1:r1:full");
    expect(details.model).toBe("gpt-6.1-sol");
    expect(details.rounds).toBe(3);
    expect(details.galleryFound).toBe(2);
  });

  it("reports a duplicate charge (retry) as zero credits used", async () => {
    research.researchGalleryImages.mockResolvedValue({
      productIdentity: "",
      images: [],
      costs: [round(9_000, 0, 900, 1)],
      searchCallCount: 1,
      stats: {},
      rejections: [],
      unverifiedNote: "",
    });
    const { rpc, params } = setup();
    rpc.mockResolvedValueOnce({ data: { success: true, duplicate: true, remaining: 100 }, error: null });
    const result = await processScrapingRow(params);
    expect(result.creditsUsed).toBe(0);
    expect(result.row.status).toBe("ready");
    expect(result.row.errorMessage).toBe("No gallery images found");
  });

  it("charges a failed row for the rounds OpenAI already billed", async () => {
    const billed = [round(9_000, 0, 900, 1)];
    research.researchGalleryImages.mockRejectedValue(new EnrichBilledAttemptError("timeout", billed));
    const { rpc, params } = setup();
    const result = await processScrapingRow(params);
    expect(result.row.status).toBe("failed");
    expect(result.creditsUsed).toBeCloseTo(sumCosts(billed).totalCredits, 6);
    expect(result.cost).toBeCloseTo(billed[0]!.totalCost, 10);
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    const details = args.p_details as Record<string, unknown>;
    expect(details.idempotencyKey).toBe("run1:r1:full:failed");
    expect(details.failedRow).toBe(true);
  });
});

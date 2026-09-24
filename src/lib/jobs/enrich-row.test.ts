import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost, costToCredits } from "@/lib/ai-pricing";
import { EnrichBilledAttemptError } from "@/lib/enrich/openai";
import type { ProjectRow } from "@/lib/storage-helpers";
import type { CatalogJobSettings } from "./types";

const enrichRowMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/enrich", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/enrich")>()),
  enrichRow: enrichRowMock,
}));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./credits", () => ({
  deductCreditsIdempotent: vi.fn(),
  isInsufficientCredits: vi.fn(() => false),
}));
vi.mock("./project-json", () => ({ loadProjectJsonAdmin: vi.fn() }));
vi.mock("./repo", () => ({ loadJobRun: vi.fn() }));

const { processCatalogRow } = await import("./enrich-row");

const row = {
  id: "row-1",
  rowIndex: 0,
  originalData: { Title: "Widget WX-1" },
  enrichedData: {},
  status: "pending",
} as unknown as ProjectRow;

const settings: CatalogJobSettings = {
  kind: "product",
  enabledColumns: ["imageUrls"],
  enrichmentColumns: [
    { id: "imageUrls", label: "Image URLs", description: "", type: "imageUrls", imageCount: 3 },
  ],
  enrichmentModel: "premium",
  sourceColumns: ["Title"],
  ownerUserId: "owner",
  actorUserId: "actor",
};

const billedCall = calculateOpenAiWebSearchCost(
  "gpt-6-sol",
  { input_tokens: 2_000, output_tokens: 500 },
  1
);
const run = () =>
  processCatalogRow({ sessionId: "s", workspaceId: "w", row, settings });

describe("processCatalogRow billing", () => {
  beforeEach(() => {
    enrichRowMock.mockReset();
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
  });

  it("charges one billed call on a first-try success", async () => {
    enrichRowMock.mockResolvedValueOnce({ data: { imageUrls: [] }, costs: [billedCall] });
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.billedAttempts).toBe(1);
    expect(outcome.cost).toBeCloseTo(billedCall.totalCost, 10);
    expect(outcome.credits).toBe(costToCredits(billedCall.totalCost));
  });

  it("adds a billed failed attempt to the successful retry", async () => {
    enrichRowMock
      .mockRejectedValueOnce(
        new EnrichBilledAttemptError("OpenAI enrich ended with status incomplete", [billedCall])
      )
      .mockResolvedValueOnce({ data: { imageUrls: [] }, costs: [billedCall] });
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.billedAttempts).toBe(2);
    expect(outcome.cost).toBeCloseTo(billedCall.totalCost * 2, 10);
    expect(outcome.credits).toBe(costToCredits(billedCall.totalCost * 2));
    expect(outcome.tokens).toBe(billedCall.usage.totalTokens * 2);
  });

  it("does not bill unbilled failures such as network errors", async () => {
    enrichRowMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({ data: { imageUrls: [] }, costs: [billedCall] });
    const outcome = await run();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.billedAttempts).toBe(1);
    expect(outcome.cost).toBeCloseTo(billedCall.totalCost, 10);
  });

  it("keeps a row that fails every attempt free", async () => {
    enrichRowMock.mockRejectedValue(
      new EnrichBilledAttemptError("OpenAI enrich returned no parseable JSON output", [billedCall])
    );
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect("credits" in outcome).toBe(false);
    expect(enrichRowMock).toHaveBeenCalledTimes(3);
  });
});

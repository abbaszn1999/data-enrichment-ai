import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost, costToCredits } from "@/lib/ai-pricing";
import {
  EnrichBilledAttemptError,
  EnrichCancelledError,
  EnrichProviderUnavailableError,
} from "@/lib/enrich/openai";
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

const { catalogCreditIdempotencyKey, processCatalogRow, PROVIDER_UNAVAILABLE_JOB_ERROR } = await import("./enrich-row");

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

  it("charges a row that fails every attempt for every attempt OpenAI billed", async () => {
    enrichRowMock.mockRejectedValue(
      new EnrichBilledAttemptError("OpenAI enrich returned no parseable JSON output", [billedCall])
    );
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // JOB_ROW_ATTEMPTS is 2, not 3 — a single call can now run up to
    // ENRICH_CALL_TIMEOUT_MS, so fewer full attempts fit the row's time budget.
    expect(enrichRowMock).toHaveBeenCalledTimes(2);
    expect(outcome.billed?.billedAttempts).toBe(2);
    expect(outcome.billed?.cost).toBeCloseTo(billedCall.totalCost * 2, 10);
    expect(outcome.billed?.credits).toBe(costToCredits(billedCall.totalCost * 2));
  });

  it("charges nothing for failures OpenAI never billed", async () => {
    enrichRowMock.mockRejectedValue(new Error("fetch failed"));
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.billed).toBeUndefined();
  });

  it("stops immediately on cancellation — no retry, charged only for what was already billed", async () => {
    enrichRowMock.mockRejectedValueOnce(
      new EnrichCancelledError("Cancelled by user", [billedCall])
    );
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.cancelled).toBe(true);
    expect(outcome.billed?.cost).toBeCloseTo(billedCall.totalCost, 10);
    expect(outcome.billed?.billedAttempts).toBe(1);
    // Never retried after a cancel, even though JOB_ROW_ATTEMPTS allows more.
    expect(enrichRowMock).toHaveBeenCalledTimes(1);
  });

  it("includes a billed failed attempt before a cancellation", async () => {
    enrichRowMock
      .mockRejectedValueOnce(new EnrichBilledAttemptError("incomplete", [billedCall]))
      .mockRejectedValueOnce(new EnrichCancelledError("Cancelled by user", [billedCall]));
    const outcome = await run();
    if (outcome.ok) throw new Error("expected a cancelled outcome");
    expect(outcome.billed?.billedAttempts).toBe(2);
    expect(outcome.billed?.cost).toBeCloseTo(billedCall.totalCost * 2, 10);
  });

  it("stops immediately when the AI provider account is unavailable — no retry, flagged for the job", async () => {
    enrichRowMock.mockRejectedValueOnce(new EnrichProviderUnavailableError());
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.providerUnavailable).toBe(true);
    expect(outcome.error).toBe(PROVIDER_UNAVAILABLE_JOB_ERROR);
    expect(outcome.billed).toBeUndefined();
    expect(enrichRowMock).toHaveBeenCalledTimes(1);
  });

  it("charges rounds OpenAI billed before the provider account ran out", async () => {
    enrichRowMock.mockRejectedValueOnce(new EnrichProviderUnavailableError(undefined, [billedCall, billedCall]));
    const outcome = await run();
    if (outcome.ok) throw new Error("expected a provider-unavailable outcome");
    expect(outcome.providerUnavailable).toBe(true);
    expect(outcome.billed?.billedAttempts).toBe(2);
    expect(outcome.billed?.cost).toBeCloseTo(billedCall.totalCost * 2, 10);
  });

  it("passes shouldCancel through to enrichRow", async () => {
    const shouldCancel = async () => false;
    enrichRowMock.mockResolvedValueOnce({ data: { imageUrls: [] }, costs: [billedCall] });
    await processCatalogRow({ sessionId: "s", workspaceId: "w", row, settings, shouldCancel });
    expect(enrichRowMock).toHaveBeenCalledWith(
      expect.objectContaining({ shouldCancel })
    );
  });

  it("passes the sheet-learned websites and the re-check flag through to the agent", async () => {
    enrichRowMock.mockResolvedValueOnce({ data: { imageUrls: [] }, costs: [billedCall] });
    await processCatalogRow({
      sessionId: "s",
      workspaceId: "w",
      row,
      settings,
      context: { learnedDomains: ["store.test"], recheck: true },
    });
    expect(enrichRowMock).toHaveBeenCalledWith(
      expect.objectContaining({ learnedDomains: ["store.test"], recheck: true })
    );
  });
});

describe("catalogCreditIdempotencyKey", () => {
  it("gives the final re-check its own key so it is charged once, separately from the first pass", () => {
    expect(catalogCreditIdempotencyKey("run", "row")).toBe("catalog_intelligence:run:row");
    expect(catalogCreditIdempotencyKey("run", "row", true)).toBe("catalog_intelligence:run:row:recheck");
  });
});

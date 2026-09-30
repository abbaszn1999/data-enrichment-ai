import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost, costToCredits, createSearchApiCost } from "@/lib/ai-pricing";
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

const { catalogCreditIdempotencyKey, chargeCatalogRow, processCatalogRow, PROVIDER_UNAVAILABLE_JOB_ERROR } = await import("./enrich-row");
const { deductCreditsIdempotent, isInsufficientCredits } = await import("./credits");

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

// Image Finder rows get exactly one attempt (it already runs three tiers), so the
// two-attempt retry rules are exercised on a regular enrichment column.
const retrySettings: CatalogJobSettings = {
  ...settings,
  enabledColumns: ["enhancedTitle"],
  enrichmentColumns: [{ id: "enhancedTitle", label: "Title", description: "", type: "text" }],
};
const runRetry = () =>
  processCatalogRow({ sessionId: "s", workspaceId: "w", row, settings: retrySettings });

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
    const outcome = await runRetry();
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
    const outcome = await runRetry();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.billedAttempts).toBe(1);
    expect(outcome.cost).toBeCloseTo(billedCall.totalCost, 10);
  });

  it("gives an Image Finder row exactly one attempt: a failed row is charged once and run again by the user", async () => {
    enrichRowMock.mockRejectedValue(new EnrichBilledAttemptError("all steps failed", [billedCall, billedCall]));
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(enrichRowMock).toHaveBeenCalledTimes(1);
    expect(outcome.billed?.billedAttempts).toBe(2);
    expect(outcome.billed?.cost).toBeCloseTo(billedCall.totalCost * 2, 10);
  });

  it("records the provider breakdown and the tiers that ran with the charge", async () => {
    const searchApi = createSearchApiCost(2);
    enrichRowMock.mockResolvedValueOnce({
      data: { imageUrls: [] },
      costs: [billedCall, searchApi],
      meta: { tiersRun: ["standard", "exact"], foundBy: "exact" },
    });
    const outcome = await run();
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.details).toMatchObject({
      tiersRun: ["standard", "exact"],
      foundBy: "exact",
      webSearchCalls: 1,
      searchApiCalls: 2,
    });
    expect(outcome.details?.searchApiCost).toBeCloseTo(searchApi.totalCost, 10);
    expect(outcome.details?.openAiCost).toBeCloseTo(billedCall.totalCost, 10);
    // One charge for everything: credits are computed on the summed dollars.
    expect(outcome.credits).toBe(costToCredits(billedCall.totalCost + searchApi.totalCost));
  });

  it("charges a row that fails every attempt for every attempt OpenAI billed", async () => {
    enrichRowMock.mockRejectedValue(
      new EnrichBilledAttemptError("OpenAI enrich returned no parseable JSON output", [billedCall])
    );
    const outcome = await runRetry();
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
    const outcome = await runRetry();
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

  it("after Stop, never starts a second attempt: the row stays pending and is charged for the first", async () => {
    enrichRowMock.mockRejectedValueOnce(new EnrichBilledAttemptError("incomplete", [billedCall]));
    const outcome = await processCatalogRow({
      sessionId: "s",
      workspaceId: "w",
      row,
      settings: retrySettings,
      shouldCancel: async () => true,
    });
    if (outcome.ok) throw new Error("expected a cancelled outcome");
    expect(outcome.cancelled).toBe(true);
    expect(outcome.billed?.billedAttempts).toBe(1);
    expect(enrichRowMock).toHaveBeenCalledTimes(1);
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

describe("chargeCatalogRow when the balance runs out (Image Finder)", () => {
  const charge = (overrides: Record<string, unknown> = {}) =>
    chargeCatalogRow({
      runId: "run",
      sessionId: "s",
      workspaceId: "w",
      rowId: "row-1",
      rowIndex: 0,
      credits: 2.5,
      cost: 0.25,
      tokens: 100,
      settings,
      ...overrides,
    });

  beforeEach(() => {
    vi.mocked(deductCreditsIdempotent).mockReset();
    vi.mocked(isInsufficientCredits).mockReset();
    vi.mocked(isInsufficientCredits).mockImplementation((error) => /insufficient/i.test(error ?? ""));
  });

  it("takes the whole charge when the balance covers it", async () => {
    vi.mocked(deductCreditsIdempotent).mockResolvedValueOnce({ success: true, remaining: 40 });
    const result = await charge();
    expect(result).toEqual({ ok: true, remaining: 40 });
    expect(deductCreditsIdempotent).toHaveBeenCalledTimes(1);
  });

  it("takes what is left under the same key, keeps the row, and reports the shortfall", async () => {
    vi.mocked(deductCreditsIdempotent)
      .mockResolvedValueOnce({ success: false, error: "Insufficient credits", remaining: 1.23456 })
      .mockResolvedValueOnce({ success: true, remaining: 0 });
    const result = await charge();

    expect(result).toEqual({ ok: true, remaining: 0, outOfCredits: { fullCredits: 2.5, chargedCredits: 1.234 } });
    const [full, partial] = vi.mocked(deductCreditsIdempotent).mock.calls.map(([args]) => args);
    expect(full.amount).toBe(2.5);
    expect(partial.amount).toBe(1.234);
    expect(partial.idempotencyKey).toBe(full.idempotencyKey);
    expect(partial.details).toMatchObject({ partial: true, fullCredits: 2.5, chargedCredits: 1.234 });
  });

  it("charges nothing but still keeps the row when the balance is already zero", async () => {
    vi.mocked(deductCreditsIdempotent).mockResolvedValueOnce({ success: false, error: "Insufficient credits", remaining: 0 });
    const result = await charge();
    expect(result).toEqual({ ok: true, remaining: 0, outOfCredits: { fullCredits: 2.5, chargedCredits: 0 } });
    expect(deductCreditsIdempotent).toHaveBeenCalledTimes(1);
  });

  it("the final re-check is charged under its own key", async () => {
    vi.mocked(deductCreditsIdempotent).mockResolvedValueOnce({ success: true, remaining: 9 });
    await charge({ recheck: true });
    expect(vi.mocked(deductCreditsIdempotent).mock.calls[0][0].idempotencyKey).toBe(
      "catalog_intelligence:run:row-1:recheck"
    );
  });

  it("does not keep a non-Image-Finder row that could not be paid: it fails as before", async () => {
    vi.mocked(deductCreditsIdempotent).mockResolvedValueOnce({ success: false, error: "Insufficient credits", remaining: 1 });
    const result = await charge({ settings: retrySettings });
    expect(result).toMatchObject({ ok: false, noCredits: true });
  });

  it("a genuine deduction error is never turned into a free row", async () => {
    vi.mocked(deductCreditsIdempotent).mockResolvedValueOnce({ success: false, error: "database unavailable" });
    const result = await charge();
    expect(result).toMatchObject({ ok: false, noCredits: false, error: "database unavailable" });
  });
});

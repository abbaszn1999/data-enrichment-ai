import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateOpenAiWebSearchCost, costToCredits, createSearchApiCost } from "@/lib/ai-pricing";
import {
  EnrichBilledAttemptError,
  EnrichCancelledError,
  EnrichOutputTruncatedError,
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
  "gpt-6.1-sol",
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

  it("does not retry a row that ran out of output space, but still charges the call and says how to fix it", async () => {
    enrichRowMock.mockRejectedValue(new EnrichOutputTruncatedError([billedCall], 128_000));
    const outcome = await runRetry();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(enrichRowMock).toHaveBeenCalledTimes(1);
    expect(outcome.error).toContain("Select fewer columns");
    expect(outcome.billed?.billedAttempts).toBe(1);
    expect(outcome.billed?.cost).toBeCloseTo(billedCall.totalCost, 10);
  });

  it("charges an earlier billed failure plus the truncated call together", async () => {
    enrichRowMock
      .mockRejectedValueOnce(new EnrichBilledAttemptError("no parseable JSON", [billedCall]))
      .mockRejectedValueOnce(new EnrichOutputTruncatedError([billedCall], 128_000));
    const outcome = await runRetry();
    if (outcome.ok) throw new Error("expected failure");
    expect(enrichRowMock).toHaveBeenCalledTimes(2);
    expect(outcome.billed?.billedAttempts).toBe(2);
    expect(outcome.billed?.cost).toBeCloseTo(billedCall.totalCost * 2, 10);
  });

  it("sends image columns to the agent as images, not text", async () => {
    enrichRowMock.mockResolvedValueOnce({ data: {}, costs: [billedCall] });
    await processCatalogRow({
      sessionId: "s",
      workspaceId: "w",
      row: {
        ...row,
        originalData: { Title: "Widget", "Image Src": "https://cdn.example.com/w.jpg" },
        enrichedData: { imageUrls: [{ imageUrl: "https://cdn.example.com/found.jpg" }] },
      } as unknown as ProjectRow,
      settings: { ...retrySettings, sourceColumns: ["Title", "Image Src", "imageUrls"] },
    });
    const call = enrichRowMock.mock.calls[0][0];
    expect(call.sourceImageUrls).toEqual(["https://cdn.example.com/w.jpg", "https://cdn.example.com/found.jpg"]);
    expect(call.productData.Title).toBe("Widget");
    expect(call.productData["Image Src"]).toBe("[1 image attached]");
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

describe("Source URLs rows (Google AI Mode)", () => {
  const sourceUrlsColumn = { id: "sourceUrls", label: "Source URLs", description: "", type: "sourceUrls" };
  const onlySourceUrls: CatalogJobSettings = {
    ...settings,
    enabledColumns: ["sourceUrls"],
    enrichmentColumns: [sourceUrlsColumn],
  };
  const mixed: CatalogJobSettings = {
    ...settings,
    enabledColumns: ["enhancedTitle", "sourceUrls"],
    enrichmentColumns: [{ id: "enhancedTitle", label: "Title", description: "", type: "text" }, sourceUrlsColumn],
  };

  beforeEach(() => {
    enrichRowMock.mockReset();
    vi.mocked(deductCreditsIdempotent).mockReset();
    vi.mocked(deductCreditsIdempotent).mockResolvedValue({ success: true, remaining: 10 });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
  });

  it("records which providers did the work with the charge", async () => {
    const charge = (s: CatalogJobSettings) =>
      chargeCatalogRow({ runId: "run", sessionId: "s", workspaceId: "w", rowId: "row-1", rowIndex: 0, credits: 0.04, cost: 0.004, tokens: 0, settings: s });
    await charge(onlySourceUrls);
    await charge(mixed);
    await charge({ ...onlySourceUrls, kind: "plp" });
    const models = vi.mocked(deductCreditsIdempotent).mock.calls.map(([args]) => (args.details as { model: string }).model);
    expect(models[0]).toBe("searchapi-google-ai-mode");
    expect(models[1]).toMatch(/^gpt-.+\+searchapi-google-ai-mode$/);
    expect(models[2]).not.toContain("searchapi");
  });

  it("charges a row exactly its Google searches plus its OpenAI call, split per provider", async () => {
    enrichRowMock.mockResolvedValueOnce({ data: {}, costs: [billedCall, createSearchApiCost(1), createSearchApiCost(1)] });
    const outcome = await processCatalogRow({ sessionId: "s", workspaceId: "w", row, settings: mixed });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const expected = billedCall.totalCost + 2 * createSearchApiCost(1).totalCost;
    expect(outcome.cost).toBeCloseTo(expected, 10);
    expect(outcome.credits).toBe(costToCredits(expected));
    expect(outcome.details).toMatchObject({ searchApiCalls: 2 });
    expect((outcome.details as { openAiCost: number }).openAiCost).toBeCloseTo(billedCall.totalCost, 10);
  });

  it("hands every attempt of a row the same Source URLs memo", async () => {
    enrichRowMock
      .mockRejectedValueOnce(new EnrichBilledAttemptError("openai failed", [billedCall, createSearchApiCost(1)]))
      .mockResolvedValueOnce({ data: {}, costs: [billedCall] });
    const outcome = await processCatalogRow({ sessionId: "s", workspaceId: "w", row, settings: mixed });
    const [first, second] = enrichRowMock.mock.calls.map(([params]) => params.sourceUrlsMemo);
    expect(first).toBeDefined();
    expect(second).toBe(first);
    // Both OpenAI attempts and the one Google search, nothing more.
    expect(outcome.ok && outcome.cost).toBeCloseTo(2 * billedCall.totalCost + createSearchApiCost(1).totalCost, 10);
  });

  it("passes AI source columns to the agent under their labels", async () => {
    enrichRowMock.mockResolvedValueOnce({ data: {}, costs: [] });
    await processCatalogRow({
      sessionId: "s",
      workspaceId: "w",
      row: { ...row, enrichedData: { sourceUrls: [{ title: "Widget", uri: "https://acme.com/wx-1" }] } } as ProjectRow,
      settings: { ...mixed, enabledColumns: ["enhancedTitle"], sourceColumns: ["Title", "sourceUrls"], sourceColumnLabels: { sourceUrls: "Source URLs" } },
    });
    expect(enrichRowMock.mock.calls[0]![0].productData).toEqual({
      Title: "Widget WX-1",
      "Source URLs": "Widget (https://acme.com/wx-1)",
    });
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

describe("Lens rows (Google Lens)", () => {
  const lensColumn = { id: "lensFounds", label: "Lens founds", description: "", type: "sourceUrls", enabled: true };
  const lensSettings: CatalogJobSettings = {
    ...settings,
    enabledColumns: ["lensFounds"],
    enrichmentColumns: [lensColumn],
    sourceColumns: ["Picture"],
  };
  const lensRow = {
    ...row,
    originalData: { Name: "Widget", Picture: "https://cdn.test/img?id=7, https://cdn.test/img?id=8" },
  } as unknown as ProjectRow;
  const charge = (overrides: Record<string, unknown> = {}) =>
    chargeCatalogRow({
      runId: "run",
      sessionId: "s",
      workspaceId: "w",
      rowId: "row-1",
      rowIndex: 0,
      credits: 0.04,
      cost: 0.004,
      tokens: 0,
      settings: lensSettings,
      ...overrides,
    });

  beforeEach(() => {
    enrichRowMock.mockReset();
    vi.mocked(deductCreditsIdempotent).mockReset();
    vi.mocked(isInsufficientCredits).mockReset();
    vi.mocked(isInsufficientCredits).mockImplementation((error) => /insufficient/i.test(error ?? ""));
  });

  it("sends the first picture of the picked column, even a link without an image extension", async () => {
    enrichRowMock.mockResolvedValueOnce({ data: {}, costs: [] });
    await processCatalogRow({ sessionId: "s", workspaceId: "w", row: lensRow, settings: lensSettings });
    expect(enrichRowMock.mock.calls[0]![0].sourceImageUrls).toEqual(["https://cdn.test/img?id=7"]);
  });

  it("charges exactly the billed Lens searches: 0.04 credits for one, 0.08 for two", async () => {
    const lens = (n: number) => Array.from({ length: n }, () => createSearchApiCost(1, "searchapi-google-lens"));
    enrichRowMock.mockResolvedValueOnce({ data: {}, costs: lens(1) });
    const one = await processCatalogRow({ sessionId: "s", workspaceId: "w", row: lensRow, settings: lensSettings });
    expect(one.ok && one.credits).toBe(0.04);
    expect(one.ok && one.details).toMatchObject({ searchApiCalls: 1, openAiCost: 0 });

    enrichRowMock.mockResolvedValueOnce({ data: {}, costs: lens(2) });
    const two = await processCatalogRow({ sessionId: "s", workspaceId: "w", row: lensRow, settings: lensSettings });
    expect(two.ok && two.credits).toBe(0.08);
    expect(two.ok && two.billedAttempts).toBe(2);
  });

  it("charges a failed row for the search that was billed before it failed", async () => {
    enrichRowMock.mockRejectedValue(
      new EnrichBilledAttemptError("answered then broke", [createSearchApiCost(1, "searchapi-google-lens")])
    );
    const outcome = await processCatalogRow({ sessionId: "s", workspaceId: "w", row: lensRow, settings: lensSettings });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.billed?.credits).toBe(0.04);
  });

  it("records Lens as the provider with the charge", async () => {
    vi.mocked(deductCreditsIdempotent).mockResolvedValueOnce({ success: true, remaining: 5 });
    await charge({ details: { searchApiCalls: 1 } });
    expect(vi.mocked(deductCreditsIdempotent).mock.calls[0]![0]).toMatchObject({
      amount: 0.04,
      idempotencyKey: "catalog_intelligence:run:row-1",
      details: { model: "searchapi-google-lens", searchApiCalls: 1, totalCost: 0.004 },
    });
  });

  it("keeps the found pages and takes what is left when the balance runs short", async () => {
    vi.mocked(deductCreditsIdempotent)
      .mockResolvedValueOnce({ success: false, error: "Insufficient credits", remaining: 0.02 })
      .mockResolvedValueOnce({ success: true, remaining: 0 });
    const result = await charge();
    expect(result).toEqual({ ok: true, remaining: 0, outOfCredits: { fullCredits: 0.04, chargedCredits: 0.02 } });
  });
});

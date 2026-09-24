import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnrichCancelledError,
  ENRICH_CALL_TIMEOUT_MS,
  billedCostsOf,
  isEnrichCancelledError,
  runEnrichOpenAiResponse,
} from "./openai";
import { buildEnrichToolPolicy } from "./policy";

const usage = { input_tokens: 1_000, output_tokens: 200 };

function completedBody() {
  return {
    status: "completed",
    usage,
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify({ enhancedTitle: "Widget" }) }],
      },
    ],
  };
}

/** A fetch mock whose pending promise rejects like real fetch does when its signal aborts. */
function abortAwareFetchMock() {
  return vi.fn((_url: string, init: { signal?: AbortSignal }) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  });
}

const baseParams = {
  tier: "standard" as const,
  promptText: "Enrich this row",
  imageUrls: [],
  policy: buildEnrichToolPolicy(["enhancedTitle"], undefined, "product"),
  schemaName: "test_schema",
  schema: { type: "object", properties: {}, additionalProperties: false },
  enabledColumns: ["enhancedTitle"],
};

describe("runEnrichOpenAiResponse cancellation (Stop)", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts the in-flight call as soon as shouldCancel returns true, without waiting for the timeout", async () => {
    const fetchMock = abortAwareFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const shouldCancel = vi.fn().mockResolvedValue(true);

    const promise = runEnrichOpenAiResponse({ ...baseParams, shouldCancel });
    const assertion = expect(promise).rejects.toBeInstanceOf(EnrichCancelledError);

    // One poll tick is enough to cancel — nowhere near the full timeout.
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(shouldCancel).toHaveBeenCalled();
  });

  it("never retries after a cancellation, even for a normally-retryable failure", async () => {
    const fetchMock = abortAwareFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const shouldCancel = vi.fn().mockResolvedValue(true);

    const promise = runEnrichOpenAiResponse({
      ...baseParams,
      imageUrls: ["https://cdn.example.com/dead.jpg"],
      shouldCancel,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(EnrichCancelledError);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;

    // Only the one aborted call — no fallback-without-image retry attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is not billed when cancelled with no prior attempt", async () => {
    const fetchMock = abortAwareFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const shouldCancel = vi.fn().mockResolvedValue(true);

    const promise = runEnrichOpenAiResponse({ ...baseParams, shouldCancel });
    // Attach the handler synchronously, before advancing timers — otherwise
    // the promise can reject mid-advance with no handler yet attached, which
    // Node reports as an unhandled rejection even though nothing is wrong.
    const errorPromise = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await errorPromise;
    expect(billedCostsOf(error)).toEqual([]);
  });

  it("does not poll or abort when no shouldCancel is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(completedBody()), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEnrichOpenAiResponse(baseParams);
    expect(result.data).toEqual({ enhancedTitle: "Widget" });
  });

  it("still succeeds normally when shouldCancel keeps returning false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(completedBody()), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const shouldCancel = vi.fn().mockResolvedValue(false);

    const result = await runEnrichOpenAiResponse({ ...baseParams, shouldCancel });
    expect(result.data).toEqual({ enhancedTitle: "Widget" });
  });
});

describe("isEnrichCancelledError / billedCostsOf", () => {
  it("recognises a cancellation and carries any prior billed cost forward", () => {
    const cost = { totalCost: 0.05 } as never;
    const error = new EnrichCancelledError("Cancelled by user", [cost]);
    expect(isEnrichCancelledError(error)).toBe(true);
    expect(billedCostsOf(error)).toEqual([cost]);
    expect(isEnrichCancelledError(new Error("other"))).toBe(false);
  });
});

describe("ENRICH_CALL_TIMEOUT_MS", () => {
  it("is meaningfully longer than the old fixed 180s, now that Stop can abort mid-call", () => {
    expect(ENRICH_CALL_TIMEOUT_MS).toBeGreaterThan(180_000);
  });
});

describe("reasoning effort override and unlimited search budget", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the override effort instead of the tier default, and sets return_token_budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(completedBody()), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await runEnrichOpenAiResponse({
      ...baseParams,
      tier: "premium",
      reasoningEffortOverride: "xhigh",
      unlimitedSearchContentBudget: true,
    });

    const request = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(request.reasoning).toEqual({ effort: "xhigh" });
    expect(request.tools[0].return_token_budget).toBe("unlimited");
  });

  it("defaults to the tier's effort and omits return_token_budget when not set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(completedBody()), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await runEnrichOpenAiResponse({ ...baseParams, tier: "premium" });

    const request = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(request.reasoning).toEqual({ effort: "high" });
    expect(request.tools[0].return_token_budget).toBeUndefined();
  });
});

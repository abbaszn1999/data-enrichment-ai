import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnrichBilledAttemptError,
  EnrichCancelledError,
  ENRICH_CALL_TIMEOUT_MS,
  billedCostsOf,
  isEnrichCancelledError,
  isEnrichProviderUnavailableError,
  isOpenAiProviderUnavailable,
  runEnrichOpenAiResponse,
  type EnrichFunctionTool,
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

const baseParams = {
  tier: "standard" as const,
  promptText: "Enrich this row",
  imageUrls: [],
  policy: buildEnrichToolPolicy(["enhancedTitle"], undefined, "product"),
  schemaName: "test_schema",
  schema: { type: "object", properties: {}, additionalProperties: false },
  enabledColumns: ["enhancedTitle"],
};

describe("runEnrichOpenAiResponse and Stop", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never aborts an in-flight call on Stop: the result OpenAI bills for is kept", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(completedBody()), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const shouldCancel = vi.fn().mockResolvedValue(true);

    const result = await runEnrichOpenAiResponse({ ...baseParams, shouldCancel });
    expect(result.data).toEqual({ enhancedTitle: "Widget" });
    expect(result.costs).toHaveLength(1);
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(false);
  });

  it("starts no fallback attempt after Stop, and carries what the failed attempt billed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ usage, error: { message: "Error while downloading file https://cdn.example.com/dead.jpg" } }),
        { status: 400 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const shouldCancel = vi.fn().mockResolvedValue(true);

    const error = await runEnrichOpenAiResponse({
      ...baseParams,
      imageUrls: ["https://cdn.example.com/dead.jpg"],
      shouldCancel,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EnrichCancelledError);
    expect(billedCostsOf(error)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a dead image link without pictures and without claiming one is attached", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ usage, error: { message: "Error while downloading file https://cdn.example.com/dead.jpg" } }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(completedBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEnrichOpenAiResponse({
      ...baseParams,
      promptText: "Product data:\n- Image: [1 image attached]\n\n1 product image is attached.",
      promptTextWithoutImages: "Product data:\n- Image: [image could not be loaded]\n\nno image is attached.",
      imageUrls: ["https://cdn.example.com/dead.jpg"],
    });

    expect(result.data).toEqual({ enhancedTitle: "Widget" });
    // The failed call was billed too.
    expect(result.costs).toHaveLength(2);
    const contentOf = (call: number) => JSON.parse(fetchMock.mock.calls[call]![1].body).input[0].content;
    expect(contentOf(0).map((part: { type: string }) => part.type)).toEqual(["input_image", "input_text"]);
    expect(contentOf(0)[1].text).toContain("1 product image is attached");
    expect(contentOf(1).map((part: { type: string }) => part.type)).toEqual(["input_text"]);
    expect(contentOf(1)[0].text).toBe("Product data:\n- Image: [image could not be loaded]\n\nno image is attached.");
  });

  it("keeps the normal text when the row never had images", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(completedBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runEnrichOpenAiResponse({ ...baseParams, promptTextWithoutImages: "should not be used" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).input[0].content[0].text).toBe("Enrich this row");
  });

  it("a failed Stop check never ends a call early", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(completedBody()), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const shouldCancel = vi.fn().mockRejectedValue(new Error("db down"));

    const result = await runEnrichOpenAiResponse({ ...baseParams, shouldCancel });
    expect(result.data).toEqual({ enhancedTitle: "Widget" });
  });

  it("works without shouldCancel", async () => {
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

describe("function-tool research loop", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const callBody = (id: string, name = "lookup") => ({
    id,
    status: "completed",
    usage,
    output: [{ type: "function_call", call_id: `call_${id}`, name, arguments: JSON.stringify({ q: id }) }],
  });
  const tool = (run: EnrichFunctionTool["run"] = vi.fn(async () => "ok")): EnrichFunctionTool => ({
    name: "lookup",
    description: "test tool",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false },
    run,
  });
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, index: number) =>
    JSON.parse(fetchMock.mock.calls[index]![1].body as string);

  it("runs tools, continues with previous_response_id, and bills every round", async () => {
    const run = vi.fn(async () => "tool result");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(callBody("resp_1")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completedBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool(run)] });

    expect(run).toHaveBeenCalledWith({ q: "resp_1" });
    expect(bodyOf(fetchMock, 0).tools[1]).toMatchObject({ type: "function", name: "lookup", strict: true });
    const second = bodyOf(fetchMock, 1);
    expect(second.previous_response_id).toBe("resp_1");
    expect(second.input).toEqual([{ type: "function_call_output", call_id: "call_resp_1", output: "tool result" }]);
    expect(result.data).toEqual({ enhancedTitle: "Widget" });
    expect(result.costs).toHaveLength(2);
  });

  it("carries rounds already billed when the provider account runs out mid-row", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(callBody("resp_1")), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "You exceeded your current quota", code: "insufficient_quota" } }), {
          status: 429,
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const error = await runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool()] }).catch((e: unknown) => e);
    expect(isEnrichProviderUnavailableError(error)).toBe(true);
    expect(billedCostsOf(error)).toHaveLength(1);
  });

  it("passes image tool outputs through as input_image content", async () => {
    const images = [
      { type: "input_text" as const, text: "Image 1" },
      { type: "input_image" as const, image_url: "data:image/jpeg;base64,AAAA", detail: "low" as const },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(callBody("resp_1")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completedBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool(async () => images)] });
    expect(bodyOf(fetchMock, 1).input[0].output).toEqual(images);
  });

  it("forces an answer with tool_choice none once the round cap is reached", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body);
      const body = request.tool_choice === "none" ? completedBody() : callBody(`resp_${fetchMock.mock.calls.length}`);
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool()], maxFunctionRounds: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(bodyOf(fetchMock, 3).tool_choice).toBe("none");
    expect(result.costs).toHaveLength(4);
  });

  it("reports unknown tools and tool failures back to the model instead of throwing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(callBody("resp_1", "missing")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completedBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool()] });
    expect(JSON.parse(bodyOf(fetchMock, 1).input[0].output).error).toContain("Unknown tool");
  });

  it("carries every billed round into a later failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(callBody("resp_1")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "incomplete", usage, output: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool()] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EnrichBilledAttemptError);
    expect((error as EnrichBilledAttemptError).costs).toHaveLength(2);
  });

  it("on Stop between rounds, runs no more research and makes the model answer with what it has", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(callBody("resp_1")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completedBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const shouldCancel = vi.fn().mockResolvedValue(true);
    const run = vi.fn(async () => "never");

    const result = await runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool(run)], shouldCancel });

    expect(run).not.toHaveBeenCalled();
    const second = bodyOf(fetchMock, 1);
    expect(second.tool_choice).toBe("none");
    expect(JSON.parse(second.input[0].output).error).toContain("stopped");
    expect(result.data).toEqual({ enhancedTitle: "Widget" });
    expect(result.costs).toHaveLength(2);
  });

  it("makes the model answer with what it has when the time budget is nearly used, instead of timing out", async () => {
    const run = vi.fn(async () => "never");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(callBody("resp_1")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completedBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool(run)], attemptBudgetMs: 60_000 });
    expect(run).not.toHaveBeenCalled();
    const second = bodyOf(fetchMock, 1);
    expect(second.tool_choice).toBe("none");
    expect(JSON.parse(second.input[0].output).error).toContain("Research time is up");
    expect(result.data).toEqual({ enhancedTitle: "Widget" });
  });

  it("returns a timeout message to the model when a tool hangs", async () => {
    vi.useFakeTimers();
    try {
      const hanging = vi.fn(() => new Promise<string>(() => undefined));
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(callBody("resp_1")), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(completedBody()), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const promise = runEnrichOpenAiResponse({ ...baseParams, functionTools: [tool(hanging)], attemptBudgetMs: 600_000 });
      await vi.advanceTimersByTimeAsync(91_000);
      await promise;
      expect(JSON.parse(bodyOf(fetchMock, 1).input[0].output).error).toContain("timed out");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the model override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(completedBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runEnrichOpenAiResponse({ ...baseParams, modelOverride: "gpt-5.6-sol" });
    expect(bodyOf(fetchMock, 0).model).toBe("gpt-5.6-sol");
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

describe("provider account unavailable (out of quota)", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws EnrichProviderUnavailableError once, without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }),
        { status: 429 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const error = await runEnrichOpenAiResponse(baseParams).catch((e: unknown) => e);
    expect(isEnrichProviderUnavailableError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recognises the known codes and messages, and nothing else", () => {
    expect(isOpenAiProviderUnavailable({ code: "insufficient_quota" })).toBe(true);
    expect(isOpenAiProviderUnavailable({ type: "credit_balance_exhausted" })).toBe(true);
    expect(isOpenAiProviderUnavailable({ message: "Your credit balance is too low to access the API" })).toBe(true);
    expect(isOpenAiProviderUnavailable({ code: "rate_limit_exceeded", message: "Rate limit reached" })).toBe(false);
    expect(isOpenAiProviderUnavailable(undefined)).toBe(false);
  });
});

describe("ENRICH_CALL_TIMEOUT_MS", () => {
  it("stays above the old fixed 180s", () => {
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

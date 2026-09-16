import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeminiMarketResearch } from "./agent/gemini-runner";
import type { GeminiRunOptions, GeminiRunResult } from "./agent/gemini-runner";

vi.mock("./agent/gemini-runner", () => ({
  runGeminiMarketResearch: vi.fn(),
}));

// Free Assessment's Stage 4 classifier is a byte-for-byte mirror of Growth
// Engine's (src/lib/market-research/agent/stage4-intent-classifier.ts).
// These tests are the Free Assessment twin of
// src/lib/market-research/agent.test.ts's Stage 4 suite, so the two flows
// can never silently drift apart again.

describe("Free Assessment Agent - Stage 4 Intent Classifier", () => {
  it("classifies keywords into category, informational, and excluded based on rules", async () => {
    const { runHeuristicStage4Classification } = await import(
      "./agent/stage4-intent-classifier"
    );

    const testKeywords = [
      { id: "kw-1", keyword: "men running shoes", volume: 14000, difficulty: 45 },
      { id: "kw-2", keyword: "how to choose running shoes", volume: 2400, difficulty: 20 },
      { id: "kw-3", keyword: "nike air zoom pegasus 40 black 256gb", volume: 800, difficulty: 15 },
      { id: "kw-4", keyword: "nike customer support login", volume: 1200, difficulty: 10 },
      { id: "kw-5", keyword: "waterproof smartwatches for swimming", volume: 3600, difficulty: 32 },
    ];

    const result = runHeuristicStage4Classification({
      keywords: testKeywords,
    });

    expect(result.classified.length).toBe(5);
    expect(result.summary.total).toBe(5);

    const kw1 = result.classified.find((c) => c.id === "kw-1");
    expect(kw1?.sheet).toBe("category");

    const kw2 = result.classified.find((c) => c.id === "kw-2");
    expect(kw2?.sheet).toBe("informational");

    const kw3 = result.classified.find((c) => c.id === "kw-3");
    expect(kw3?.sheet).toBe("excluded");

    const kw4 = result.classified.find((c) => c.id === "kw-4");
    expect(kw4?.sheet).toBe("excluded");

    const kw5 = result.classified.find((c) => c.id === "kw-5");
    expect(kw5?.sheet).toBe("category");

    // Every heuristic-derived row must be flagged as such, per-keyword —
    // never presented as if Gemini classified it.
    for (const item of result.classified) {
      expect(item.isAiGenerated).toBe(false);
    }
  });
});

describe("Free Assessment Agent - Stage 4 Batching and Concurrency", () => {
  const originalApiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
    vi.mocked(runGeminiMarketResearch).mockReset();
  });

  it(
    "batches at 100/call with concurrency 5, retries a transient failure, heuristically falls back only for a persistently-failing batch, and never mixes ids across batches",
    async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const { runStage4IntentClassification } = await import(
        "./agent/stage4-intent-classifier"
      );

      // 950 keywords -> 10 batches of 100 (last batch has 50).
      const TOTAL = 950;
      const keywords = Array.from({ length: TOTAL }, (_, i) => ({
        id: `kw-${i}`,
        keyword: `term ${i}`,
      }));

      let inFlight = 0;
      let maxInFlight = 0;
      const attemptsByBatchStart = new Map<string, number>();

      vi.mocked(runGeminiMarketResearch).mockImplementation(async (
        opts: GeminiRunOptions
      ): Promise<GeminiRunResult<unknown>> => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);

        const parsed = JSON.parse(opts.userPrompt) as {
          keywordsToClassify: Array<{ id: string }>;
        };
        const ids: string[] = parsed.keywordsToClassify.map((k) => k.id);
        const batchKey = ids[0];

        // Batch 3 (starts at kw-200) fails once, then succeeds on retry.
        const isFlakyBatch = batchKey === "kw-200";
        // Batch 6 (starts at kw-500) always fails, forcing a heuristic fallback.
        const isBrokenBatch = batchKey === "kw-500";

        const attempts = (attemptsByBatchStart.get(batchKey) ?? 0) + 1;
        attemptsByBatchStart.set(batchKey, attempts);

        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;

        if (isBrokenBatch) {
          throw new Error("simulated persistent Gemini failure");
        }
        if (isFlakyBatch && attempts === 1) {
          throw new Error("simulated transient Gemini failure");
        }

        return {
          data: {
            classifications: ids.map((id) => ({
              id,
              sheet: "category",
              confidence: 0.95,
              reason: `AI reason for ${id}`,
            })),
          },
          rawText: "",
          cost: {} as GeminiRunResult<unknown>["cost"],
          credits: 0,
          model: "gemini-3.7-flash",
          thinkingLevel: "low",
        };
      });

      const result = await runStage4IntentClassification({ keywords });

      // One batch (100 keywords) persistently failed even after the full
      // retry budget and fell back to the regex heuristic. isAiGenerated
      // must reflect that truthfully — claiming "true" here is the exact
      // class of bug this fix closes: heuristic guesses must never be
      // presented as agent verdicts. degradedCount names exactly how many
      // keywords fell back.
      expect(result.isAiGenerated).toBe(false);
      expect(result.degradedCount).toBe(100);
      expect(result.classified.length).toBe(TOTAL);

      // Every keyword got exactly one classification, matched by its own id —
      // no batch's response leaked onto another batch's rows.
      const byId = new Map(result.classified.map((c) => [c.id, c]));
      expect(byId.size).toBe(TOTAL);
      for (const kw of keywords) {
        expect(byId.has(kw.id)).toBe(true);
      }

      // Batches ran with bounded concurrency (>1, capped at 5) rather than
      // fully sequential or unbounded parallel.
      expect(maxInFlight).toBeGreaterThan(1);
      expect(maxInFlight).toBeLessThanOrEqual(5);

      // The flaky batch recovered via retry and used the real AI path —
      // per-item isAiGenerated must say so.
      expect(byId.get("kw-200")?.reason).toContain("AI reason");
      expect(byId.get("kw-200")?.isAiGenerated).toBe(true);
      expect(attemptsByBatchStart.get("kw-200")).toBe(2);

      // The persistently-broken batch fell back to the heuristic classifier
      // (not the mocked AI reason) after exhausting the full retry budget
      // (3 attempts: 1 initial + 2 retries), not endless retries — and every
      // one of its keywords must be flagged isAiGenerated: false.
      expect(byId.get("kw-500")?.reason).not.toContain("AI reason");
      expect(byId.get("kw-500")?.isAiGenerated).toBe(false);
      expect(attemptsByBatchStart.get("kw-500")).toBe(3);
    },
    15000
  );

  it(
    "recovers keywords missing from an otherwise-successful batch via a targeted re-request, only falling back to the heuristic for whatever is still missing afterwards",
    async () => {
      process.env.GEMINI_API_KEY = "test-key";
      const { runStage4IntentClassification } = await import(
        "./agent/stage4-intent-classifier"
      );

      // One batch of 100. Gemini's first response silently omits 3 ids —
      // a known LLM list-completion gap, not a capacity issue (100 short
      // JSON rows is nowhere near this model's output budget).
      const TOTAL = 100;
      const keywords = Array.from({ length: TOTAL }, (_, i) => ({
        id: `kw-${i}`,
        keyword: `term ${i}`,
      }));
      const omittedFromFirstCall = new Set(["kw-50", "kw-75", "kw-90"]);
      // Of those, the targeted re-request only recovers two — the third
      // stays missing even after the cheap follow-up call and must be the
      // only one that falls back to the heuristic.
      const stillMissingAfterRetry = new Set(["kw-90"]);

      const callPayloads: string[][] = [];

      vi.mocked(runGeminiMarketResearch).mockImplementation(async (
        opts: GeminiRunOptions
      ): Promise<GeminiRunResult<unknown>> => {
        const parsed = JSON.parse(opts.userPrompt) as {
          keywordsToClassify: Array<{ id: string }>;
        };
        const ids: string[] = parsed.keywordsToClassify.map((k) => k.id);
        callPayloads.push(ids);

        const isFullBatch = ids.length === TOTAL;
        const omit = isFullBatch ? omittedFromFirstCall : stillMissingAfterRetry;

        return {
          data: {
            classifications: ids
              .filter((id) => !omit.has(id))
              .map((id) => ({
                id,
                sheet: "category",
                confidence: 0.95,
                reason: `AI reason for ${id}`,
              })),
          },
          rawText: "",
          cost: {} as GeminiRunResult<unknown>["cost"],
          credits: 0,
          model: "gemini-3.7-flash",
          thinkingLevel: "low",
        };
      });

      const result = await runStage4IntentClassification({ keywords });
      const byId = new Map(result.classified.map((c) => [c.id, c]));

      // Exactly two calls: the full 100-keyword batch, then one targeted
      // re-request containing ONLY the 3 ids missing from the first
      // response — never the full batch again.
      expect(callPayloads.length).toBe(2);
      expect(callPayloads[0]?.length).toBe(TOTAL);
      expect(new Set(callPayloads[1])).toEqual(omittedFromFirstCall);

      // Recovered via the targeted re-request: real AI verdicts, not guesses.
      expect(byId.get("kw-50")?.isAiGenerated).toBe(true);
      expect(byId.get("kw-50")?.reason).toContain("AI reason");
      expect(byId.get("kw-75")?.isAiGenerated).toBe(true);
      expect(byId.get("kw-75")?.reason).toContain("AI reason");

      // Still missing even after the targeted re-request -> heuristic for
      // just that one keyword, clearly flagged as not a real verdict.
      expect(byId.get("kw-90")?.isAiGenerated).toBe(false);
      expect(byId.get("kw-90")?.reason).not.toContain("AI reason");

      expect(result.degradedCount).toBe(1);
      expect(result.isAiGenerated).toBe(false);
      expect(result.classified.length).toBe(TOTAL);
    },
    15000
  );
});

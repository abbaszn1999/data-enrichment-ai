import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("./gemini-runner", () => ({ runGeminiMarketResearch: gemini.run }));

import {
  DUPLICATE_CHECK_BATCH,
  mergeDuplicateResults,
  runDuplicateCollectionExclusion,
} from "./stage5-duplicate-exclusion";

type Prompted = {
  newCollections: Array<{ id: string; name: string }>;
  existingCollections: Array<{ id: string; name: string }>;
};

function promptOf(args: { userPrompt: string }): Prompted {
  return JSON.parse(args.userPrompt.slice(args.userPrompt.indexOf('{"newCollections"')));
}

const existing = [
  { id: "e1", name: "Sofas" },
  { id: "e2", name: "Garden hoses" },
];

function news(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, name: i % 10 === 0 ? `dup ${i}` : `new ${i}` }));
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runDuplicateCollectionExclusion batching", () => {
  it("makes one call when everything fits in a batch", async () => {
    gemini.run.mockImplementation(async (args: { userPrompt: string }) => ({
      data: {
        duplicates: promptOf(args)
          .newCollections.filter((c) => c.name.startsWith("dup"))
          .map((c) => ({ id: c.id, status: "duplicate" })),
      },
    }));
    const result = await runDuplicateCollectionExclusion(news(50), existing);
    expect(gemini.run).toHaveBeenCalledTimes(1);
    expect(result.checked).toBe(true);
    expect(result.duplicateIds.size).toBe(5);
  });

  it("splits a large run into batches that each see the full existing list", async () => {
    const seen: number[] = [];
    gemini.run.mockImplementation(async (args: { userPrompt: string }) => {
      const prompt = promptOf(args);
      seen.push(prompt.newCollections.length);
      expect(prompt.existingCollections).toHaveLength(existing.length);
      return {
        data: {
          duplicates: prompt.newCollections
            .filter((c) => c.name.startsWith("dup"))
            .map((c) => ({ id: c.id, status: "duplicate" })),
        },
      };
    });
    const total = DUPLICATE_CHECK_BATCH * 2 + 40;
    const result = await runDuplicateCollectionExclusion(news(total), existing);
    expect(gemini.run).toHaveBeenCalledTimes(3);
    expect(seen.sort((a, b) => a - b)).toEqual([40, DUPLICATE_CHECK_BATCH, DUPLICATE_CHECK_BATCH]);
    expect(result.checked).toBe(true);
    // Every tenth collection is a duplicate, wherever its batch landed.
    expect(result.duplicateIds.size).toBe(Math.ceil(total / 10));
    expect(result.uncheckedIds?.size ?? 0).toBe(0);
  });

  it("marks only the failed batch as unchecked and keeps the other answers", async () => {
    vi.useFakeTimers();
    gemini.run.mockImplementation(async (args: { userPrompt: string }) => {
      const prompt = promptOf(args);
      if (prompt.newCollections.some((c) => c.id === "n350")) throw new Error("model down");
      return {
        data: {
          duplicates: prompt.newCollections
            .filter((c) => c.name.startsWith("dup"))
            .map((c) => ({ id: c.id, status: "duplicate" })),
        },
      };
    });
    const pending = runDuplicateCollectionExclusion(news(700), existing);
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(result.checked).toBe(false);
    // The failed batch is ids 300..599; nothing outside it is unknown.
    expect(result.uncheckedIds?.size).toBe(300);
    expect(result.uncheckedIds?.has("n350")).toBe(true);
    expect(result.uncheckedIds?.has("n10")).toBe(false);
    expect(result.uncheckedIds?.has("n650")).toBe(false);
    // Duplicates from the batches that did run are kept; none from the failed one.
    expect(result.duplicateIds.has("n10")).toBe(true);
    expect(result.duplicateIds.has("n650")).toBe(true);
    expect(result.duplicateIds.has("n350")).toBe(false);
  });

  it("treats nothing to compare against as a clean check", async () => {
    const result = await runDuplicateCollectionExclusion(news(500), []);
    expect(result.checked).toBe(true);
    expect(gemini.run).not.toHaveBeenCalled();
  });
});

describe("mergeDuplicateResults", () => {
  it("reports checked only when every batch ran", () => {
    const ok = { duplicateIds: new Set(["a"]), matchesById: new Map(), checked: true };
    const bad = { duplicateIds: new Set<string>(), matchesById: new Map(), checked: false };
    const batches = [[{ id: "a", name: "A" }], [{ id: "b", name: "B" }]];
    const merged = mergeDuplicateResults(batches, [ok, bad]);
    expect(merged.checked).toBe(false);
    expect([...merged.uncheckedIds!]).toEqual(["b"]);
    expect([...merged.duplicateIds]).toEqual(["a"]);
    expect(mergeDuplicateResults(batches, [ok, ok]).checked).toBe(true);
  });
});

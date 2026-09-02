import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedProduct } from "@/lib/sync/core/types";
import type { ClassificationTarget } from "./types";

const generateContent = vi.hoisted(() => vi.fn());
const calculateCallCostMock = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  ThinkingLevel: { MEDIUM: "MEDIUM" },
}));

vi.mock("@/lib/ai-pricing", () => ({
  calculateCallCost: (...args: unknown[]) => calculateCallCostMock(...args),
}));

const { classifyProducts, CLASSIFY_TUNING, candidateTargetsForProduct } = await import("./classify");

/** Queues one Gemini response and its matching billed cost — `classifyProducts`
 *  sums the cost across batches to bill the wallet at the agent's real price. */
function geminiResult(verdicts: unknown[], totalCost = 0.0001) {
  calculateCallCostMock.mockReturnValueOnce({ totalCost });
  return { text: JSON.stringify({ verdicts }), usageMetadata: {} };
}

function product(id: string, title: string, extra: Partial<DetectedProduct> = {}) {
  return {
    id,
    title,
    createdAt: "2026-08-01T00:00:00Z",
    ...extra,
  } satisfies DetectedProduct;
}

const cables: ClassificationTarget = {
  collectionId: "c1",
  taxonomyRef: "gid://shopify/Collection/1",
  name: "USB-C Charging Cables",
  targetKeyword: "usb c charging cables",
};

const stands: ClassificationTarget = {
  collectionId: "c2",
  taxonomyRef: "gid://shopify/Collection/2",
  name: "Laptop Cooling Stands",
};

beforeEach(() => {
  generateContent.mockReset();
  calculateCallCostMock.mockReset();
  calculateCallCostMock.mockReturnValue({ totalCost: 0.0001 });
  process.env.GEMINI_API_KEY = "test-key";
});

describe("classifyProducts", () => {
  it("skips everything when the project has nothing live on the store", async () => {
    const { decisions, totalCostUsd, validatedCount } = await classifyProducts({
      products: [product("p1", "USB-C Charging Cable 2m")],
      targets: [],
      sourceByProductId: new Map([["p1", "watched-1"]]),
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe("skipped");
    expect(decisions[0].reason).toMatch(/no categories live/i);
    expect(generateContent).not.toHaveBeenCalled();
    expect(totalCostUsd).toBe(0);
    expect(validatedCount).toBe(0);
  });

  it("sends every live category when the catalog is already within the candidate cap", async () => {
    generateContent.mockResolvedValue(geminiResult([]));

    const { decisions, validatedCount } = await classifyProducts({
      products: [product("p1", "Ceramic Flower Vase")],
      targets: [cables, stands],
      sourceByProductId: new Map([["p1", "watched-1"]]),
    });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0] as {
      contents: { parts: { text: string }[] }[];
    };
    const prompt = call.contents[0].parts[0].text;
    expect(prompt).toContain(cables.taxonomyRef);
    expect(prompt).toContain(stands.taxonomyRef);
    expect(decisions[0].decision).toBe("skipped");
    expect(validatedCount).toBe(1);
  });

  it("assigns only what the agent accepts", async () => {
    generateContent.mockResolvedValue(
      geminiResult(
        [
          {
            productId: "p1",
            taxonomyRef: cables.taxonomyRef,
            belongs: true,
            reason: "It is a USB-C charging cable",
          },
        ],
        0.002
      )
    );

    const { decisions, totalCostUsd, validatedCount } = await classifyProducts({
      products: [product("p1", "USB-C Charging Cable 2m")],
      targets: [cables, stands],
      sourceByProductId: new Map([["p1", "watched-1"]]),
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe("assigned");
    expect(decisions[0].target?.taxonomyRef).toBe(cables.taxonomyRef);
    expect(decisions[0].sourceTaxonomyRef).toBe("watched-1");
    expect(totalCostUsd).toBeCloseTo(0.002);
    expect(validatedCount).toBe(1);
  });

  it("records the agent's own wording when it rejects every candidate", async () => {
    generateContent.mockResolvedValue(
      geminiResult([
        {
          productId: "p1",
          taxonomyRef: cables.taxonomyRef,
          belongs: false,
          reason: "An adapter is not a cable",
        },
      ])
    );

    const { decisions } = await classifyProducts({
      products: [product("p1", "USB-C Charging Adapter Cable Hub")],
      targets: [cables, stands],
      sourceByProductId: new Map([["p1", "watched-1"]]),
    });

    expect(decisions[0].decision).toBe("skipped");
    expect(decisions[0].reason).toBe("An adapter is not a cable");
  });

  it("drops a verdict for a taxonomy that isn't live on the store", async () => {
    generateContent.mockResolvedValue(
      geminiResult([
        {
          productId: "p1",
          taxonomyRef: "gid://shopify/Collection/999",
          belongs: true,
          reason: "Invented destination",
        },
      ])
    );

    const { decisions } = await classifyProducts({
      products: [product("p1", "USB-C Charging Cable 2m")],
      targets: [cables, stands],
      sourceByProductId: new Map([["p1", "watched-1"]]),
    });

    // Accepted but not a live category, so it must not become an assignment.
    expect(decisions.every((d) => d.decision !== "assigned")).toBe(true);
  });

  it("marks a batch failed rather than skipped when the agent call throws", async () => {
    generateContent.mockRejectedValue(new Error("429 rate limited"));

    const { decisions, totalCostUsd } = await classifyProducts({
      products: [product("p1", "USB-C Charging Cable 2m")],
      targets: [cables],
      sourceByProductId: new Map([["p1", "watched-1"]]),
    });

    expect(decisions[0].decision).toBe("failed");
    expect(decisions[0].reason).toBe("429 rate limited");
    expect(totalCostUsd).toBe(0);
  });

  it("batches up to PRODUCTS_PER_CALL products into a single agent call", async () => {
    const products = Array.from({ length: CLASSIFY_TUNING.PRODUCTS_PER_CALL }, (_, i) =>
      product(`p${i + 1}`, "USB-C Charging Cable")
    );
    generateContent.mockResolvedValue(geminiResult([]));

    const { validatedCount } = await classifyProducts({
      products,
      targets: [cables],
      sourceByProductId: new Map(products.map((p) => [p.id, "watched-1"])),
    });

    // A whole run's worth of products reaches the agent in one call — that is
    // what keeps Sync's wallet cost down to a fraction of a cent per run.
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(validatedCount).toBe(CLASSIFY_TUNING.PRODUCTS_PER_CALL);
  });

  it("keeps the batches that succeeded when one agent call fails", async () => {
    const perCall = CLASSIFY_TUNING.PRODUCTS_PER_CALL;
    const products = Array.from({ length: perCall * 2 + 50 }, (_, i) =>
      product(`p${i + 1}`, "USB-C Charging Cable")
    );
    generateContent
      .mockResolvedValueOnce(geminiResult([]))
      .mockRejectedValueOnce(new Error("429 rate limited"))
      .mockResolvedValueOnce(geminiResult([]));

    const { decisions, totalCostUsd } = await classifyProducts({
      products,
      targets: [cables],
      sourceByProductId: new Map(products.map((p) => [p.id, "watched-1"])),
    });

    // perCall + perCall + 50, and only the middle batch is marked failed.
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(decisions.filter((d) => d.decision === "failed")).toHaveLength(perCall);
    expect(decisions.filter((d) => d.decision === "skipped")).toHaveLength(perCall + 50);
    // Cost only accrues for the two batches that actually returned.
    expect(totalCostUsd).toBeCloseTo(0.0002);
  });

  it("allows one product into several categories", async () => {
    generateContent.mockResolvedValue(
      geminiResult([
        { productId: "p1", taxonomyRef: cables.taxonomyRef, belongs: true, reason: "cable" },
        { productId: "p1", taxonomyRef: stands.taxonomyRef, belongs: true, reason: "stand" },
      ])
    );

    const { decisions } = await classifyProducts({
      products: [product("p1", "Laptop Cooling Stand with USB-C Charging Cable")],
      targets: [cables, stands],
      sourceByProductId: new Map([["p1", "watched-1"]]),
    });

    const assigned = decisions.filter((d) => d.decision === "assigned");
    expect(assigned.map((d) => d.target?.taxonomyRef).sort()).toEqual(
      [cables.taxonomyRef, stands.taxonomyRef].sort()
    );
  });

  it("pre-filters a large catalog to the overlapping candidates", () => {
    const noise = Array.from({ length: 40 }, (_, i) => ({
      collectionId: `n${i}`,
      taxonomyRef: `gid://shopify/Collection/${100 + i}`,
      name: `Unrelated Niche ${i}`,
    }));
    const picked = candidateTargetsForProduct(
      product("p1", "USB-C Charging Cable 2m"),
      [...noise, cables, stands],
      8
    );
    expect(picked).toHaveLength(8);
    expect(picked.some((t) => t.taxonomyRef === cables.taxonomyRef)).toBe(true);
  });
});

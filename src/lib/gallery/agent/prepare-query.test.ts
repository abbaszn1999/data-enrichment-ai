import { beforeEach, describe, expect, it, vi } from "vitest";

const interactionCreate = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    interactions = { create: interactionCreate };
  },
}));

import { rankGalleryCandidates } from "@/lib/gallery/agent/prepare-query";

const candidate = {
  imageUrl: "https://cdn.example.com/item.webp",
  title: "Brand exact SKU front",
  sourceDomain: "example.com",
  inline: { data: Buffer.from("image").toString("base64"), mimeType: "image/webp" },
};

describe("strict candidate vision validation", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("validates a single candidate instead of auto-accepting it", async () => {
    interactionCreate.mockResolvedValue({
      status: "completed",
      output_text: '{"selectedIndices":[]}',
      usage: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    });
    const result = await rankGalleryCandidates({
      productIdentity: "Brand exact SKU",
      candidates: [candidate],
      limit: 1,
      purpose: "gallery",
      matchStrictness: "strict",
    });
    expect(interactionCreate).toHaveBeenCalledOnce();
    expect(result.selectedIndices).toEqual([]);
  });

  it("fails closed when vision transport fails", async () => {
    interactionCreate.mockRejectedValue(new Error("network failure"));
    const result = await rankGalleryCandidates({
      productIdentity: "Brand exact SKU",
      candidates: [candidate],
      limit: 1,
      purpose: "main",
      matchStrictness: "strict",
    });
    expect(result.selectedIndices).toEqual([]);
  });

  it("keeps completed-call cost when JSON is invalid", async () => {
    interactionCreate.mockResolvedValue({
      status: "completed",
      output_text: "not-json",
      usage: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
    });
    const result = await rankGalleryCandidates({
      productIdentity: "Brand exact SKU",
      candidates: [candidate],
      limit: 1,
      purpose: "gallery",
      matchStrictness: "strict",
    });
    expect(result.selectedIndices).toEqual([]);
    expect(result.cost?.totalCost).toBeGreaterThan(0);
  });
});

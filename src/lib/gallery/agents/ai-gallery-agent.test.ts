import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { buildNanoBananaPrompt, generateAiGalleryImage, isRetryableImageError } from "./ai-gallery-agent";
import type { AiReferenceImage } from "./ai-shared";
import { buildAiRowCharge } from "../agent/ai-row-billing";

const shot = {
  perspective: "front" as const,
  specClaim: "claim",
  prompt: "Use image 1 as the exact product. Front view on a white sweep with a soft grounded shadow.",
  useLogo: false,
  alt: "alt",
};
const reference: AiReferenceImage = {
  role: "product",
  label: "product photo, the trusted Main image of the exact item",
  contentType: "image/jpeg",
  buffer: Buffer.from("x"),
};
const settings = { aspectRatio: "1:1", resolution: "1K", outputFormat: "image/jpeg", groundWithSearch: false } as const;

async function jpegBase64() {
  const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
  return buffer.toString("base64");
}

function fakeAi(create: (params: unknown) => Promise<unknown>) {
  return { interactions: { create } } as unknown as GoogleGenAI;
}

const usage = {
  total_input_tokens: 2000,
  total_output_tokens: 1120,
  total_thought_tokens: 200,
  output_tokens_by_modality: [{ modality: "image", tokens: 1120 }],
};

describe("buildNanoBananaPrompt", () => {
  it("appends the numbered reference list and identity rules to the planner prompt", () => {
    const text = buildNanoBananaPrompt({ shot, references: [reference], identityRules: "Keep the product identical." });
    expect(text.startsWith(shot.prompt)).toBe(true);
    expect(text).toContain("Image 1: product photo");
    expect(text.endsWith("Keep the product identical.")).toBe(true);
  });
});

describe("generateAiGalleryImage", () => {
  it("sends the prompt and every reference and prices the call from usage", async () => {
    const create = vi.fn().mockResolvedValue({
      status: "completed",
      id: "i1",
      output_image: { data: await jpegBase64(), mime_type: "image/jpeg" },
      usage,
    });
    const result = await generateAiGalleryImage({
      ai: fakeAi(create),
      model: "gemini-3.1-flash-image",
      settings,
      shot,
      references: [reference],
      identityRules: "rules",
      rowId: "r1",
      galleryIndex: 0,
    });
    expect(result.image?.contentType).toBe("image/jpeg");
    expect(result.costs).toHaveLength(1);
    expect(result.costs[0].imageCostSource).toBe("usage");
    const body = create.mock.calls[0][0] as { input: Array<{ type: string }>; response_format: Record<string, unknown>; generation_config?: unknown };
    expect(body.input.map((part) => part.type)).toEqual(["text", "image"]);
    expect(body.response_format).toMatchObject({ type: "image", aspect_ratio: "1:1", image_size: "1K", mime_type: "image/jpeg" });
    expect(body.generation_config).toEqual({ thinking_level: "high" });
  });

  it("converts to PNG when PNG is chosen", async () => {
    const create = vi.fn().mockResolvedValue({
      status: "completed",
      output_image: { data: await jpegBase64(), mime_type: "image/jpeg" },
      usage,
    });
    const result = await generateAiGalleryImage({
      ai: fakeAi(create),
      model: "gemini-3-pro-image",
      settings: { ...settings, outputFormat: "image/png" },
      shot,
      references: [reference],
      identityRules: "",
      rowId: "r1",
      galleryIndex: 0,
    });
    expect(result.image?.contentType).toBe("image/png");
    expect(result.image?.buffer.subarray(1, 4).toString()).toBe("PNG");
    const body = create.mock.calls[0][0] as { response_format: Record<string, unknown>; generation_config?: unknown };
    expect(body.response_format.mime_type).toBeUndefined();
    expect(body.generation_config).toBeUndefined();
  });

  it("keeps the billed usage of a call that returned no image", async () => {
    const create = vi.fn().mockResolvedValue({
      status: "completed",
      usage: { total_input_tokens: 3000, total_output_tokens: 0, total_thought_tokens: 400 },
    });
    const result = await generateAiGalleryImage({
      ai: fakeAi(create),
      model: "gemini-3-pro-image",
      settings,
      shot,
      references: [reference],
      identityRules: "",
      rowId: "r1",
      galleryIndex: 0,
    });
    expect(result.image).toBeNull();
    expect(result.costs).toHaveLength(1);
    expect(result.costs[0].totalCost).toBeCloseTo((3000 / 1e6) * 2 + (400 / 1e6) * 12, 8);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("retries once on a rate limit, then succeeds", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce({ status: "completed", output_image: { data: await jpegBase64(), mime_type: "image/jpeg" }, usage });
    const result = await generateAiGalleryImage({
      ai: fakeAi(create),
      model: "gemini-3.1-flash-image",
      settings,
      shot,
      references: [reference],
      identityRules: "",
      rowId: "r1",
      galleryIndex: 0,
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.image).not.toBeNull();
  });

  it("does not retry a bad request", async () => {
    const create = vi.fn().mockRejectedValue(new Error("400 invalid argument"));
    const result = await generateAiGalleryImage({
      ai: fakeAi(create),
      model: "gemini-3.1-flash-image",
      settings,
      shot,
      references: [reference],
      identityRules: "",
      rowId: "r1",
      galleryIndex: 0,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.image).toBeNull();
    expect(result.error).toContain("400");
    expect(isRetryableImageError("503 unavailable")).toBe(true);
  });
});

describe("buildAiRowCharge", () => {
  it("sums planner rounds and every image call, failed ones included, into one total", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ status: "completed", usage: { total_input_tokens: 2000, total_output_tokens: 0, total_thought_tokens: 300 } })
      .mockResolvedValueOnce({ status: "completed", output_image: { data: await jpegBase64(), mime_type: "image/jpeg" }, usage });
    const run = () =>
      generateAiGalleryImage({
        ai: fakeAi(create),
        model: "gemini-3.1-flash-image",
        settings,
        shot,
        references: [reference],
        identityRules: "",
        rowId: "r1",
        galleryIndex: 0,
      });
    const failed = await run();
    const ok = await run();
    const charge = buildAiRowCharge({
      plannerCosts: [],
      imageCosts: [...failed.costs, ...ok.costs],
      plannerModel: "gpt-6.1-sol",
      imageModel: "gemini-3.1-flash-image",
      resolution: "1K",
      aspectRatio: "1:1",
      outputFormat: "image/jpeg",
      requestedImages: 2,
      generatedImages: 1,
      failedImages: 1,
      plannerReused: false,
      references: { product: 1 },
    });
    const expected = failed.costs[0].totalCost + ok.costs[0].totalCost;
    expect(charge.totals.totalCost).toBeCloseTo(expected, 10);
    expect(charge.details.imageCalls).toBe(2);
    expect(charge.details.failedImages).toBe(1);
  });
});

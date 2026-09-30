import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImageGenerationCost } from "@/lib/ai-pricing";

const state = {
  generated: [] as Array<{ index: number; references: string[]; prompt: string }>,
  failIndexes: new Set<number>(),
  deductCalls: [] as Array<Record<string, unknown>>,
  deductResult: { success: true } as { success: boolean; error?: string; duplicate?: boolean },
  removed: [] as string[][],
  uploaded: [] as string[],
};

const usage = {
  total_input_tokens: 2000,
  total_output_tokens: 1320,
  total_thought_tokens: 200,
  output_tokens_by_modality: [{ modality: "image", tokens: 1120 }],
};

vi.mock("@google/genai", () => ({ GoogleGenAI: class {} }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/global-concurrency", () => ({ withAiSlot: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/lib/sync/agent/ai-utils", () => ({ requireGeminiApiKey: () => "key" }));
vi.mock("@/lib/visualizer/skill-loader", () => ({
  loadVisualizerSkill: async () => ({ instructions: "identity lock" }),
}));
vi.mock("@/lib/visualizer/log", () => ({ visualizerLog: vi.fn(), visualizerWarn: vi.fn() }));
vi.mock("@/lib/visualizer/storage-paths", () => ({
  getVisualizerRowImagePath: (_w: string, _s: string, rowId: string, index: number, ext: string) =>
    `w/s/${rowId}/${index}.${ext}`,
}));
vi.mock("@/lib/visualizer/storage-admin", () => ({
  uploadVisualizerBytesAdmin: async (path: string) => {
    state.uploaded.push(path);
  },
  removeVisualizerPathsAdmin: async (paths: string[]) => {
    state.removed.push(paths);
  },
}));
vi.mock("@/lib/visualizer/credits", () => ({
  deductVisualizerCredits: async (params: Record<string, unknown>) => {
    state.deductCalls.push(params);
    return state.deductResult;
  },
}));
vi.mock("@/lib/visualizer/references", () => ({
  loadVisualizerReferences: async () => ({
    ordered: [
      { role: "product", label: "product", contentType: "image/jpeg", buffer: Buffer.from("p") },
      { role: "logo", label: "logo", contentType: "image/png", buffer: Buffer.from("l") },
    ],
    productCount: 1,
    hasLogo: true,
    hasBrandGuide: false,
    counts: { product: 1, logo: 1 },
    staleLogo: false,
    staleBrandGuide: false,
  }),
}));
vi.mock("@/lib/ai-images/nano-banana", () => ({
  generateNanoBananaImage: async (params: {
    galleryIndex: number;
    references: Array<{ role: string }>;
    shot: { prompt: string };
  }) => {
    state.generated.push({
      index: params.galleryIndex,
      references: params.references.map((reference) => reference.role),
      prompt: params.shot.prompt,
    });
    if (state.failIndexes.has(params.galleryIndex)) {
      return {
        image: null,
        costs: [createImageGenerationCost("gemini-3.1-flash-image", "1K", usage, 0, { imageReturned: false })],
        error: "The image model returned no final image",
        prompt: params.shot.prompt,
      };
    }
    return {
      image: { buffer: Buffer.from("img"), contentType: "image/jpeg" as const },
      costs: [createImageGenerationCost("gemini-3.1-flash-image", "1K", usage, 0, { imageReturned: true })],
      prompt: params.shot.prompt,
    };
  },
}));

import { processImagesRow } from "./process-images-row";
import { parseVisualizerProjectSettings } from "./settings-schema";
import type { VisualizerRow } from "./types";

const prompt = "Use image 1 as the exact product. Three-quarter view on wet slate, soft overcast light, square frame.";

function row(storage: Array<string | null>, useLogo: boolean[] = []): VisualizerRow {
  return {
    id: "r1",
    rowIndex: 0,
    status: "generating",
    originalData: { Title: "Shoe", Image: "https://cdn.shop.com/a.jpg" },
    generatedDescription: `<article>${storage
      .map((path, i) =>
        path
          ? `<figure><img src="vz-storage:${path}" /></figure>`
          : `<div>[imageplaceholder-${i + 1}]</div>`
      )
      .join("")}</article>`,
    imagePlaceholders: storage.map((path, i) => ({
      index: i + 1,
      visualBrief: prompt,
      prompt,
      alt: `alt ${i + 1}`,
      useLogo: useLogo[i] === true,
      storagePath: path,
    })),
  };
}

const settings = parseVisualizerProjectSettings({
  selectedColumns: ["Title", "Image"],
  productImageColumn: "Image",
  images: { tier: "standard", brandingEnabled: true },
});

function run(input: VisualizerRow, extra: Record<string, unknown> = {}) {
  return processImagesRow({
    admin: {} as never,
    workspaceId: "w",
    sessionId: "s",
    row: input,
    settings,
    ownerUserId: "owner",
    actorUserId: "actor",
    runId: "run1",
    ...extra,
  });
}

describe("processImagesRow", () => {
  beforeEach(() => {
    state.generated = [];
    state.failIndexes = new Set();
    state.deductCalls = [];
    state.deductResult = { success: true };
    state.removed = [];
    state.uploaded = [];
  });

  it("generates only the empty slots and never touches finished images", async () => {
    const result = await run(row(["w/s/r1/1.jpg", null, null], [false, true, false]));
    expect(state.generated.map((item) => item.index).sort()).toEqual([2, 3]);
    expect(state.removed).toEqual([]);
    expect(result.row.status).toBe("images_ready");
    const placeholders = result.row.imagePlaceholders ?? [];
    expect(placeholders.every((item) => !!item.storagePath)).toBe(true);
    expect(placeholders[0].storagePath).toBe("w/s/r1/1.jpg");
    expect(result.row.generatedDescription).toContain("vz-storage:w/s/r1/2.jpg");
    expect(result.row.generatedDescription).not.toContain("[imageplaceholder-");
  });

  it("sends the logo only to shots the planner flagged", async () => {
    await run(row([null, null, null], [false, true, false]));
    const byIndex = new Map(state.generated.map((item) => [item.index, item.references]));
    expect(byIndex.get(1)).toEqual(["product"]);
    expect(byIndex.get(2)).toEqual(["product", "logo"]);
    expect(byIndex.get(3)).toEqual(["product"]);
  });

  it("sends the planner prompt as the shot prompt", async () => {
    await run(row([null]));
    expect(state.generated[0].prompt).toBe(prompt);
  });

  it("charges once per row and keys the charge by the generated slots", async () => {
    const result = await run(row([null, null, null]));
    expect(state.deductCalls).toHaveLength(1);
    const call = state.deductCalls[0] as { amount: number; operation: string; details: Record<string, unknown> };
    expect(call.operation).toBe("visualizer_images");
    expect(call.details.idempotencyKey).toBe("run1:visualizer_images:r1:1-2-3");
    expect(call.details).toMatchObject({ model: "gemini-3.1-flash-image", tier: "standard", generatedImages: 3, imageCalls: 3 });
    expect(result.creditsUsed).toBe(call.amount);
    expect(result.creditsUsed).toBeGreaterThan(0);
  });

  it("keeps finished images when one slot fails and charges all billed calls once", async () => {
    state.failIndexes = new Set([3]);
    const result = await run(row([null, null, null]));
    expect(state.deductCalls).toHaveLength(1);
    const call = state.deductCalls[0] as { details: Record<string, unknown> };
    expect(call.details.idempotencyKey).toBe("run1:visualizer_images:r1:1-2");
    expect(call.details).toMatchObject({ generatedImages: 2, failedImages: 1, imageCalls: 3 });
    expect(result.row.status).toBe("description_ready");
    expect(result.row.errorMessage).toContain("Created 2 of 3 images");
    expect(state.removed).toEqual([]);
    expect((result.row.imagePlaceholders ?? []).filter((item) => item.storagePath)).toHaveLength(2);
  });

  it("fails without a charge when nothing was created, and records the cost", async () => {
    state.failIndexes = new Set([1, 2]);
    const result = await run(row([null, null]));
    expect(state.deductCalls).toHaveLength(0);
    expect(result.row.status).toBe("failed");
    expect(result.creditsUsed).toBe(0);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.error).toContain("Image ");
  });

  it("does nothing when every slot already has an image", async () => {
    const result = await run(row(["a.jpg", "b.jpg"]));
    expect(state.generated).toHaveLength(0);
    expect(state.deductCalls).toHaveLength(0);
    expect(result.row.status).toBe("images_ready");
  });

  it("removes the new files and fails the row when the charge is refused", async () => {
    state.deductResult = { success: false, error: "INSUFFICIENT_CREDITS" };
    const result = await run(row([null, null]));
    expect(result.row.status).toBe("failed");
    expect(result.error).toBe("INSUFFICIENT_CREDITS");
    expect(state.removed.flat().sort()).toEqual(["w/s/r1/1.jpg", "w/s/r1/2.jpg"]);
    expect(result.creditsUsed).toBe(0);
  });

  it("checkpoints after each stored image", async () => {
    const checkpoints: Array<Record<string, unknown>> = [];
    await run(row([null, null]), {
      onCheckpoint: async (patch: Record<string, unknown>) => {
        checkpoints.push(patch);
      },
    });
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[1]).toMatchObject({ generationStage: "images" });
    const last = checkpoints[1].imagePlaceholders as Array<{ storagePath: string | null }>;
    expect(last.every((item) => !!item.storagePath)).toBe(true);
  });

  it("stops before the first image when Stop was requested", async () => {
    const result = await run(row([null, null]), { shouldCancel: async () => true });
    expect(state.generated).toHaveLength(0);
    expect(result.row.status).toBe("description_ready");
    expect(result.row.errorMessage).toContain("Stopped");
  });

  it("does not start images when the time budget is spent", async () => {
    const result = await run(row([null, null]), { deadlineAt: Date.now() + 1_000 });
    expect(state.generated).toHaveLength(0);
    expect(result.row.status).toBe("description_ready");
    expect(result.row.errorMessage).toContain("time budget");
  });

  it("does not charge a repeated run twice for the same slots", async () => {
    state.deductResult = { success: true, duplicate: true };
    const result = await run(row([null]));
    expect(result.creditsUsed).toBe(0);
  });
});

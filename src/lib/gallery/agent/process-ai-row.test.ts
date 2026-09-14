import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  type GalleryRow,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";
import type { AiCallCost } from "@/lib/ai-pricing";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  generateMain: vi.fn(),
  generateGallery: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  deduct: vi.fn(),
  downloadStored: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor() {}
  },
}));

vi.mock("@/lib/gallery/agents/ai-planner-agent", () => ({
  planGalleryImages: mocks.plan,
}));

vi.mock("@/lib/gallery/agents/ai-main-agent", () => ({
  generateAiMainImage: mocks.generateMain,
}));

vi.mock("@/lib/gallery/agents/ai-gallery-agent", () => ({
  generateAiGalleryImage: mocks.generateGallery,
}));

vi.mock("@/lib/gallery/providers/serper-images", () => ({
  downloadImageBytes: mocks.download,
}));

vi.mock("@/lib/gallery/storage-admin", () => ({
  downloadGalleryBytesAdmin: mocks.downloadStored,
  uploadGalleryBytesAdmin: mocks.upload,
  removeGalleryPathsAdmin: mocks.remove,
}));

vi.mock("@/lib/gallery/agent/process-row", () => ({
  deductGalleryCredits: mocks.deduct,
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => ({}),
}));

import { processAiRow } from "@/lib/gallery/agent/process-ai-row";

function zeroCost(): AiCallCost {
  return {
    model: "test",
    usage: {
      promptTokens: 1,
      candidatesTokens: 1,
      thoughtsTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    usedGoogleSearch: false,
    inputCost: 0,
    cachedInputCost: 0,
    cacheWriteCost: 0,
    outputCost: 0.01,
    searchCost: 0,
    serperCost: 0,
    serpApiCost: 0,
    totalCost: 0.01,
  };
}

function row(): GalleryRow {
  return {
    id: "row-1",
    rowIndex: 0,
    status: "not_started",
    originalData: { SKU: "EXACT-123" },
    mainImagePath: null,
    galleryImagePaths: [],
  };
}

function worksheet(): GalleryWorksheetJson {
  return {
    sessionId: "session-1",
    columns: ["SKU"],
    originalImageColumn: null,
    selectedColumns: ["SKU"],
    settings: {
      provider: "ai",
      scraping: DEFAULT_SCRAPING_SETTINGS,
      ai: { ...DEFAULT_AI_SETTINGS, imagesPerRow: 2 },
    },
    activeRun: null,
    rows: [],
  };
}

describe("processAiRow wait-for-Main", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    mocks.plan.mockReset();
    mocks.generateMain.mockReset();
    mocks.generateGallery.mockReset();
    mocks.download.mockReset();
    mocks.upload.mockReset();
    mocks.remove.mockReset();
    mocks.deduct.mockReset();
    mocks.downloadStored.mockReset();
    mocks.upload.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.deduct.mockResolvedValue({ success: true, duplicate: false });
    mocks.plan.mockResolvedValue({
      plan: {
        fingerprint: "fp",
        main: {
          specClaim: "identity",
          visualBrief: "Clean hero",
          alt: "Hero",
        },
        gallery: [
          {
            index: 1,
            specClaim: "waterproof",
            visualBrief: "Water on the shell",
            alt: "Waterproof",
          },
          {
            index: 2,
            specClaim: "UV",
            visualBrief: "Harsh sun on the surface",
            alt: "UV",
          },
        ],
      },
      cost: zeroCost(),
      model: "gpt-5.6-terra",
    });
  });

  it("does not start Gallery until this SKU's Main has resolved", async () => {
    let releaseMain: ((value: unknown) => void) | undefined;
    let mainFinished = false;
    mocks.generateMain.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseMain = (value) => {
            mainFinished = true;
            resolve(value);
          };
        })
    );
    mocks.generateGallery.mockImplementation(async (params) => {
      expect(mainFinished).toBe(true);
      expect(params.references.some((item: { buffer?: Buffer }) => item.buffer)).toBe(
        true
      );
      return {
        buffer: Buffer.from("gallery"),
        contentType: "image/jpeg",
        cost: zeroCost(),
      };
    });

    const pending = processAiRow({
      workspaceId: "ws",
      sessionId: "session-1",
      worksheet: worksheet(),
      row: row(),
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-1",
      runPhase: "full",
    });

    await vi.waitFor(() => {
      expect(mocks.generateMain).toHaveBeenCalledTimes(1);
    });
    expect(mocks.generateGallery).not.toHaveBeenCalled();

    releaseMain?.({
      buffer: Buffer.from("main-bytes"),
      contentType: "image/jpeg",
      cost: zeroCost(),
    });
    const result = await pending;
    expect(result.error).toBeUndefined();
    expect(mocks.generateGallery).toHaveBeenCalledTimes(2);
    expect(mocks.plan.mock.calls[0][0].needMain).toBe(true);
  });

  it("never calls the Gallery agent when Main generation throws", async () => {
    mocks.generateMain.mockRejectedValue(new Error("Main model failed"));

    const result = await processAiRow({
      workspaceId: "ws",
      sessionId: "session-1",
      worksheet: worksheet(),
      row: row(),
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-1",
      runPhase: "full",
    });

    expect(result.error).toMatch(/Main model failed/);
    expect(mocks.generateGallery).not.toHaveBeenCalled();
    expect(result.row.status).toBe("failed");
  });
});

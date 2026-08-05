import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
  type GalleryRow,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  searchMain: vi.fn(),
  searchGallery: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/gallery/providers/serper-images", () => ({
  downloadImageBytes: mocks.download,
}));
vi.mock("@/lib/gallery/agents/scraping-main-agent", () => ({
  searchScrapingMainImages: mocks.searchMain,
}));
vi.mock("@/lib/gallery/agents/scraping-gallery-agent", () => ({
  searchScrapingGalleryImages: mocks.searchGallery,
}));
vi.mock("@/lib/gallery/storage-assets", () => ({
  uploadGalleryAsset: mocks.upload,
  removeGalleryAssets: mocks.remove,
}));
vi.mock("@/lib/gallery/storage-admin", () => ({
  downloadGalleryBytesAdmin: vi.fn(),
  uploadGalleryBytesAdmin: mocks.upload,
}));
vi.mock("@/lib/workspace-context", () => ({
  updateCachedCredits: vi.fn(),
}));

import {
  NO_GALLERY_MESSAGE,
  processScrapingRow,
} from "@/lib/gallery/agent/process-row";

let horizontal: Buffer;
let vertical: Buffer;

async function stripedImage(direction: "horizontal" | "vertical") {
  const width = 160;
  const height = 120;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = direction === "horizontal" ? x : y;
      const offset = (y * width + x) * 3;
      data[offset] = value % 255;
      data[offset + 1] = (value * 3) % 255;
      data[offset + 2] = (255 - value) % 255;
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function row(): GalleryRow {
  return {
    id: "row-1",
    rowIndex: 0,
    status: "not_started",
    originalData: { SKU: "EXACT-123", Image: "https://images.example/main.png" },
    mainImagePath: null,
    galleryImagePaths: [],
  };
}

function worksheet(
  originalImageColumn: string | null,
  imagesPerRow: number
): GalleryWorksheetJson {
  return {
    sessionId: "session-1",
    columns: ["SKU", "Image"],
    originalImageColumn,
    originalImageSelectionExplicit: true,
    selectedColumns: ["SKU"],
    settings: {
      provider: "scraping",
      scraping: { ...DEFAULT_SCRAPING_SETTINGS, imagesPerRow },
      ai: DEFAULT_AI_SETTINGS,
    },
    activeRun: null,
    rows: [row()],
  };
}

const searchMainResult = (mainCandidates: unknown[]) => ({
  productIdentity: "Brand EXACT-123",
  mainCandidates,
  allImageResults: [...mainCandidates],
  cost: null,
  searchCallCount: 1,
});

const searchGalleryResult = (galleryCandidates: unknown[]) => ({
  productIdentity: "Brand EXACT-123",
  galleryCandidates,
  allImageResults: [...galleryCandidates],
  cost: null,
  searchCallCount: 1,
});

describe("two-stage scraping row", () => {
  beforeAll(async () => {
    [horizontal, vertical] = await Promise.all([
      stripedImage("horizontal"),
      stripedImage("vertical"),
    ]);
  });

  beforeEach(() => {
    mocks.download.mockImplementation(async (url: string) => ({
      buffer: url.includes("gallery") ? vertical : horizontal,
      contentType: "image/png",
      ext: "png",
    }));
    mocks.upload.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.searchMain.mockResolvedValue(searchMainResult([]));
    mocks.searchGallery.mockResolvedValue(searchGalleryResult([]));
  });

  it("finds Main only when no original image is selected", async () => {
    const mainCandidate = {
      imageUrl: "https://cdn.example/main.png",
      pageUrl: "https://example.com/product",
      title: "Brand EXACT-123",
      width: 0,
      height: 0,
      sourceDomain: "example.com",
    };
    mocks.searchMain.mockResolvedValue(searchMainResult([mainCandidate]));

    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet(null, 1),
      row: row(),
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-1",
      runPhase: "main",
    });

    expect(mocks.searchMain).toHaveBeenCalledTimes(1);
    expect(mocks.searchGallery).not.toHaveBeenCalled();
    expect(mocks.searchMain).toHaveBeenCalledWith(
      expect.objectContaining({
        rowData: expect.objectContaining({ SKU: "EXACT-123" }),
      })
    );
    expect(result.row.status).toBe("ready");
    expect(result.row.mainImagePaths).toEqual([
      expect.stringMatching(
        /^workspace\/gallery\/session-1\/rows\/row-1\/main-.+\.png$/
      ),
    ]);
    expect(result.row.mainImagePath).toBe(result.row.mainImagePaths?.[0]);
    expect(result.row.galleryImagePaths).toEqual([]);
    expect(result.row.errorMessage).toBeUndefined();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("runs Gallery only after Main exists", async () => {
    const galleryCandidate = {
      imageUrl: "https://cdn.example/gallery.png",
      pageUrl: "https://example.com/product",
      title: "Brand EXACT-123 side",
      width: 0,
      height: 0,
      sourceDomain: "example.com",
    };
    mocks.searchGallery.mockResolvedValue(searchGalleryResult([galleryCandidate]));
    const existing = row();
    existing.mainImagePath = "https://cdn.example/main.png";
    existing.mainImagePaths = ["https://cdn.example/main.png"];
    existing.sourceMeta = {
      provider: "scraping",
      images: [
        {
          ref: "https://cdn.example/main.png",
          url: "https://cdn.example/main.png",
          role: "main",
          persistence: "external",
          sourceUrl: "https://cdn.example/main.png",
          pageUrl: "https://example.com/product",
        },
      ],
    };

    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet(null, 1),
      row: existing,
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-1b",
      runPhase: "gallery",
    });

    expect(mocks.searchMain).not.toHaveBeenCalled();
    expect(mocks.searchGallery).toHaveBeenCalledTimes(1);
    expect(mocks.searchGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedGalleryImages: 1,
        mainImages: [
          expect.objectContaining({
            url: "https://cdn.example/main.png",
            buffer: expect.any(Buffer),
            contentType: "image/png",
          }),
        ],
      })
    );
    expect(result.row.mainImagePaths).toEqual(["https://cdn.example/main.png"]);
    expect(result.row.galleryImagePaths).toEqual([galleryCandidate.imageUrl]);
    expect(result.row.sourceMeta?.images).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: "https://cdn.example/main.png",
          role: "main",
        }),
        expect.objectContaining({
          ref: galleryCandidate.imageUrl,
          role: "gallery",
          persistence: "external",
        }),
      ])
    );
  });

  it("auto-selects Gallery phase when Main already exists", async () => {
    const galleryCandidate = {
      imageUrl: "https://cdn.example/gallery-auto.png",
      pageUrl: "https://example.com/product",
      title: "Brand EXACT-123 lifestyle",
      width: 0,
      height: 0,
      sourceDomain: "example.com",
    };
    mocks.searchGallery.mockResolvedValue(searchGalleryResult([galleryCandidate]));
    const existing = row();
    existing.mainImagePath = "https://cdn.example/main.png";
    existing.mainImagePaths = ["https://cdn.example/main.png"];

    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet(null, 2),
      row: existing,
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-1-auto",
    });

    expect(mocks.searchMain).not.toHaveBeenCalled();
    expect(mocks.searchGallery).toHaveBeenCalledTimes(1);
    expect(mocks.searchGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedGalleryImages: 2,
        mainImages: [
          expect.objectContaining({
            url: "https://cdn.example/main.png",
            buffer: expect.any(Buffer),
          }),
        ],
      })
    );
    expect(result.row.galleryImagePaths).toEqual([galleryCandidate.imageUrl]);
  });

  it("fails Gallery when Main image cannot be downloaded", async () => {
    mocks.download.mockResolvedValue(null);
    const existing = row();
    existing.mainImagePath = "https://cdn.example/main.png";
    existing.mainImagePaths = ["https://cdn.example/main.png"];

    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet(null, 1),
      row: existing,
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-1-nodl",
      runPhase: "gallery",
    });

    expect(mocks.searchGallery).not.toHaveBeenCalled();
    expect(result.row.status).toBe("failed");
    expect(result.error).toMatch(/Could not download the Main image/i);
    expect(result.row.mainImagePaths).toEqual(["https://cdn.example/main.png"]);
  });

  it("reports when no suitable Main image is found", async () => {
    mocks.searchMain.mockResolvedValue(searchMainResult([]));
    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet(null, 1),
      row: row(),
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-1c",
    });

    expect(result.row.status).toBe("failed");
    expect(result.row.errorMessage).toBe(
      "No suitable main image found for this product"
    );
    expect(result.row.mainImagePaths).toEqual([]);
  });

  it("keeps Main separate when one requested Gallery image is not found", async () => {
    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet("Image", 1),
      row: row(),
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-2",
    });

    expect(mocks.searchGallery).toHaveBeenCalledWith(
      expect.objectContaining({ requestedGalleryImages: 1 })
    );
    expect(result.creditsUsed).toBe(0);
    expect(result.row.status).toBe("ready");
    expect(result.row.errorMessage).toBe(NO_GALLERY_MESSAGE);
  });

  it("sends the original Main to OpenAI and previews returned Gallery URLs", async () => {
    const galleryCandidate = {
      imageUrl: "https://cdn.example/gallery.png",
      pageUrl: "https://example.com/product",
      title: "Brand EXACT-123 side",
      width: 0,
      height: 0,
      sourceDomain: "example.com",
    };
    mocks.searchGallery.mockResolvedValue(searchGalleryResult([galleryCandidate]));
    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet("Image", 1),
      row: row(),
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-3",
    });

    expect(mocks.searchGallery).toHaveBeenCalledTimes(1);
    expect(mocks.searchGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedGalleryImages: 1,
        mainImages: [
          expect.objectContaining({
            url: expect.stringMatching(
              /^workspace\/gallery\/session-1\/rows\/row-1\/main-.+\.png$/
            ),
            buffer: expect.any(Buffer),
          }),
        ],
      })
    );
    expect(result.row.mainImagePaths).toEqual([
      expect.stringMatching(
        /^workspace\/gallery\/session-1\/rows\/row-1\/main-.+\.png$/
      ),
    ]);
    expect(result.row.galleryImagePaths).toEqual([galleryCandidate.imageUrl]);
    expect(result.row.errorMessage).toBeUndefined();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it("copies every original image URL into Main and sends all of them to Gallery", async () => {
    const galleryCandidate = {
      imageUrl: "https://cdn.example/gallery-multi.png",
      pageUrl: "https://example.com/product",
      title: "Brand EXACT-123 detail",
      width: 0,
      height: 0,
      sourceDomain: "example.com",
    };
    mocks.searchGallery.mockResolvedValue(searchGalleryResult([galleryCandidate]));
    const multi = row();
    multi.originalData = {
      SKU: "EXACT-123",
      Image:
        "https://images.example/front.png https://images.example/back.png https://images.example/side.png",
    };

    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet("Image", 2),
      row: multi,
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-multi-original",
    });

    expect(mocks.searchMain).not.toHaveBeenCalled();
    expect(mocks.upload).toHaveBeenCalledTimes(3);
    expect(result.row.mainImagePaths).toHaveLength(3);
    expect(mocks.searchGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedGalleryImages: 2,
        mainImages: [
          expect.objectContaining({ buffer: expect.any(Buffer) }),
          expect.objectContaining({ buffer: expect.any(Buffer) }),
          expect.objectContaining({ buffer: expect.any(Buffer) }),
        ],
      })
    );
    expect(result.row.galleryImagePaths).toEqual([galleryCandidate.imageUrl]);
  });

  it("sends every existing Main image to the Gallery agent", async () => {
    const galleryCandidate = {
      imageUrl: "https://cdn.example/gallery-from-mains.png",
      pageUrl: "https://example.com/product",
      title: "Brand EXACT-123 lifestyle",
      width: 0,
      height: 0,
      sourceDomain: "example.com",
    };
    mocks.searchGallery.mockResolvedValue(searchGalleryResult([galleryCandidate]));
    const existing = row();
    existing.mainImagePaths = [
      "https://cdn.example/main-1.png",
      "https://cdn.example/main-2.png",
    ];
    existing.mainImagePath = existing.mainImagePaths[0] ?? null;

    const result = await processScrapingRow({
      admin: {} as never,
      workspaceId: "workspace",
      sessionId: "session-1",
      worksheet: worksheet(null, 1),
      row: existing,
      ownerUserId: "owner",
      actorUserId: "actor",
      runId: "run-multi-main-gallery",
      runPhase: "gallery",
    });

    expect(mocks.searchGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        mainImages: [
          expect.objectContaining({
            url: "https://cdn.example/main-1.png",
            buffer: expect.any(Buffer),
          }),
          expect.objectContaining({
            url: "https://cdn.example/main-2.png",
            buffer: expect.any(Buffer),
          }),
        ],
      })
    );
    expect(result.row.mainImagePaths).toEqual([
      "https://cdn.example/main-1.png",
      "https://cdn.example/main-2.png",
    ]);
    expect(result.row.galleryImagePaths).toEqual([galleryCandidate.imageUrl]);
  });
});

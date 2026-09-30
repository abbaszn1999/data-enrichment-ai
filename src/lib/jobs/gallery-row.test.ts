import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/gallery/storage-admin", () => ({ loadGalleryWorksheetAdmin: vi.fn() }));
vi.mock("./repo", () => ({ loadJobRun: vi.fn(), isJobCancelRequested: vi.fn() }));

import { loadGalleryRowContext } from "./gallery-row";
import type { GalleryJobSettings } from "./gallery-settings";

const runtimeSettings = {
  provider: "scraping",
  originalImageColumn: "Image",
  originalImageSelectionExplicit: true,
  selectedColumns: ["Title", "Image"],
  columnLayout: { order: [], hidden: [] },
  scraping: { imagesPerRow: 6, searchDepth: "medium", instructions: "white background" },
  ai: {},
} as unknown as GalleryJobSettings["runtimeSettings"];

function adminReturning(result: { data: unknown; error: unknown }) {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (column: string, value: string) => {
    calls.push(`${column}=${value}`);
    return chain;
  };
  chain.maybeSingle = async () => result;
  return { admin: { from: vi.fn(() => chain) } as never, calls };
}

const jobSettings = { provider: "scraping", runtimeSettings } as unknown as GalleryJobSettings;

describe("loadGalleryRowContext", () => {
  it("builds a one-row worksheet from the row store and the run's frozen settings", async () => {
    const { admin, calls } = adminReturning({
      error: null,
      data: {
        row_id: "r7",
        row_index: 6,
        status: "generating",
        data: {
          originalData: { Title: "Acme Shoe", Image: "https://cdn.shop.com/main.jpg" },
          galleryImagePaths: [],
          mainImagePaths: [],
          mainImagePath: null,
        },
      },
    });
    const context = await loadGalleryRowContext({
      admin,
      workspaceId: "w1",
      sessionId: "s1",
      rowId: "r7",
      jobSettings,
    });
    expect(calls).toEqual(["session_id=s1", "row_id=r7"]);
    expect(context?.row).toMatchObject({ id: "r7", rowIndex: 6, status: "generating" });
    expect(context?.worksheet.rows).toHaveLength(1);
    expect(context?.worksheet.originalImageColumn).toBe("Image");
    expect(context?.worksheet.settings.scraping.imagesPerRow).toBe(6);
    expect(context?.worksheet.settings.scraping.instructions).toBe("white background");
  });

  it("falls back (null) when the row is not in the store", async () => {
    const { admin } = adminReturning({ data: null, error: null });
    const context = await loadGalleryRowContext({
      admin,
      workspaceId: "w1",
      sessionId: "s1",
      rowId: "missing",
      jobSettings,
    });
    expect(context).toBeNull();
  });

  it("loads only the row for AI runs too, with the run's frozen AI settings", async () => {
    const aiRuntime = {
      ...(runtimeSettings as object),
      provider: "ai",
      ai: { tier: "premium", imagesPerRow: 3, instructions: "model wears it", sceneReferencePath: "w1/s1/scene.jpg" },
    } as unknown as GalleryJobSettings["runtimeSettings"];
    const { admin, calls } = adminReturning({
      error: null,
      data: {
        row_id: "r9",
        row_index: 8,
        status: "generating",
        data: {
          originalData: { Title: "Linen dress", Image: "https://cdn.shop.com/dress.jpg" },
          galleryImagePaths: [],
        },
      },
    });
    const context = await loadGalleryRowContext({
      admin,
      workspaceId: "w1",
      sessionId: "s1",
      rowId: "r9",
      jobSettings: { provider: "ai", runtimeSettings: aiRuntime } as unknown as GalleryJobSettings,
    });
    expect(calls).toEqual(["session_id=s1", "row_id=r9"]);
    expect(context?.worksheet.rows).toHaveLength(1);
    expect(context?.worksheet.settings.ai.tier).toBe("premium");
    expect(context?.worksheet.settings.ai.sceneReferencePath).toBe("w1/s1/scene.jpg");
    expect(context?.worksheet.originalImageColumn).toBe("Image");
  });
});

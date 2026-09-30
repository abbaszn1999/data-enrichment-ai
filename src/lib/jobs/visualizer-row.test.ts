import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/visualizer/storage-admin", () => ({ loadVisualizerWorksheetAdmin: vi.fn() }));
vi.mock("@/lib/visualizer/process-description-row", () => ({ processDescriptionRow: vi.fn() }));
vi.mock("@/lib/visualizer/process-images-row", () => ({ processImagesRow: vi.fn() }));
vi.mock("@/lib/catalog/flag", () => ({ visualizerRowStoreEnabled: () => true }));
vi.mock("./repo", () => ({ loadJobRun: vi.fn(), isJobCancelRequested: vi.fn() }));

import { loadVisualizerRowContext } from "./visualizer-row";
import type { VisualizerJobSettings } from "./visualizer-settings";

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

const runtimeSettings = {
  selectedColumns: ["Title", "Image"],
  productImageColumn: "Image",
  images: { tier: "premium" },
  description: { layoutId: "zigzag", imageCount: 3 },
} as unknown as VisualizerJobSettings["runtimeSettings"];

describe("loadVisualizerRowContext", () => {
  it("reads only the row from the row store and the run's frozen settings", async () => {
    const { admin, calls } = adminReturning({
      error: null,
      data: {
        row_id: "r7",
        row_index: 6,
        status: "generating",
        data: {
          originalData: { Title: "Acme Shoe", Image: "https://cdn.shop.com/main.jpg" },
          generatedDescription: "<p>[imageplaceholder-1]</p>",
        },
      },
    });
    const context = await loadVisualizerRowContext({
      admin,
      sessionId: "s1",
      rowId: "r7",
      jobSettings: { runtimeSettings } as unknown as VisualizerJobSettings,
    });
    expect(calls).toEqual(["session_id=s1", "row_id=r7"]);
    expect(context?.row).toMatchObject({ id: "r7", rowIndex: 6, status: "generating" });
    expect(context?.settings.images.tier).toBe("premium");
    expect(context?.settings.description.imageCount).toBe(3);
    expect(context?.settings.productImageColumn).toBe("Image");
  });

  it("falls back (null) when the row is not in the store", async () => {
    const { admin } = adminReturning({ data: null, error: null });
    const context = await loadVisualizerRowContext({
      admin,
      sessionId: "s1",
      rowId: "missing",
      jobSettings: { runtimeSettings } as unknown as VisualizerJobSettings,
    });
    expect(context).toBeNull();
  });

  it("falls back (null) when the run has no frozen settings", async () => {
    const { admin } = adminReturning({ data: null, error: null });
    const context = await loadVisualizerRowContext({
      admin,
      sessionId: "s1",
      rowId: "r7",
      jobSettings: {} as VisualizerJobSettings,
    });
    expect(context).toBeNull();
  });
});

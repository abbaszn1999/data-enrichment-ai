import { beforeEach, describe, expect, it, vi } from "vitest";

const loadCategoriesJsonServer = vi.fn();
vi.mock("@/lib/storage-helpers-server", () => ({
  loadCategoriesJsonServer: (...args: unknown[]) => loadCategoriesJsonServer(...args),
}));

import { loadCategorySnapshot, runUsesCategories } from "./snapshot";

const cat = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  slug: name.toLowerCase(),
  parentId,
  description: "long description that should not be copied into the job",
});

describe("runUsesCategories", () => {
  it("is true only when a category-aware column is enabled", () => {
    expect(runUsesCategories(["categories"])).toBe(true);
    expect(runUsesCategories(["parentCategory"])).toBe(true);
    expect(runUsesCategories(["internalLinks", "h1"])).toBe(true);
    expect(runUsesCategories(["enhancedTitle", "images"])).toBe(false);
    expect(runUsesCategories([])).toBe(false);
  });
});

describe("loadCategorySnapshot", () => {
  beforeEach(() => loadCategoriesJsonServer.mockReset());

  it("reads the list on the server and builds full paths", async () => {
    loadCategoriesJsonServer.mockResolvedValue([
      cat("1", "Electronics"),
      cat("2", "Phones", "1"),
      cat("3", "Smartphones", "2"),
    ]);
    const snapshot = await loadCategorySnapshot("ws-1");
    expect(loadCategoriesJsonServer).toHaveBeenCalledWith("ws-1");
    expect(snapshot.map((c) => c.fullPath)).toEqual([
      "Electronics",
      "Electronics > Phones",
      "Electronics > Phones > Smartphones",
    ]);
  });

  it("keeps only what the agent reads", async () => {
    loadCategoriesJsonServer.mockResolvedValue([cat("1", "Sale")]);
    const [item] = await loadCategorySnapshot("ws-1");
    expect(Object.keys(item).sort()).toEqual(["fullPath", "id", "name", "parentId", "slug"]);
  });

  it("returns an empty list for an empty Categories tab", async () => {
    loadCategoriesJsonServer.mockResolvedValue([]);
    expect(await loadCategorySnapshot("ws-1")).toEqual([]);
  });

  it("survives cycles and orphans", async () => {
    loadCategoriesJsonServer.mockResolvedValue([
      cat("1", "A", "2"),
      cat("2", "B", "1"),
      cat("3", "C", "missing"),
    ]);
    const snapshot = await loadCategorySnapshot("ws-1");
    expect(snapshot).toHaveLength(3);
    for (const item of snapshot) expect(item.fullPath.length).toBeGreaterThan(0);
  });
});

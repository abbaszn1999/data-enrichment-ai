import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CategoryJson } from "./storage-helpers";
import type { ProductRow } from "@/types";

let stored: CategoryJson[] = [];
const saveCategoriesJson = vi.fn(async (_ws: string, cats: CategoryJson[]) => {
  stored = cats;
  return "path";
});

vi.mock("./storage-helpers", () => ({
  loadCategoriesJson: vi.fn(async () => stored.map((c) => ({ ...c }))),
  saveCategoriesJson: (ws: string, cats: CategoryJson[]) =>
    saveCategoriesJson(ws, cats),
}));

const { applyPlpWriteBack, countRowsWithPlpContent } = await import(
  "./plp-writeback"
);

function row(name: string, enriched: Record<string, unknown>): ProductRow {
  return {
    id: `row-${name}`,
    rowIndex: 0,
    selected: true,
    status: "done",
    originalData: { name },
    enrichedData: enriched as ProductRow["enrichedData"],
  };
}

describe("applyPlpWriteBack", () => {
  beforeEach(() => {
    saveCategoriesJson.mockClear();
    stored = [
      { id: "c1", name: "Running Shoes", slug: "running-shoes" },
      {
        id: "c2",
        name: "Trail Shoes",
        slug: "trail-shoes",
        seo: { seoTitle: "Old title", h1: "Old h1" },
      },
    ];
  });

  it("writes SEO fields and merges without wiping earlier copy", async () => {
    const result = await applyPlpWriteBack({
      workspaceId: "w1",
      sessionId: "s1",
      rows: [
        row("Running Shoes", {
          seoTitle: "Running Shoes | Store",
          faq: [{ question: "Q?", answer: "A." }],
          secondaryKeywords: ["road running shoes", ""],
        }),
        row("trail shoes ", { seoTitle: "Trail Shoes | Store" }),
      ],
      sourceColumn: "name",
    });

    expect(result).toEqual({ updated: 2, unmatched: 0, skipped: 0 });

    expect(stored[0].seo?.seoTitle).toBe("Running Shoes | Store");
    expect(stored[0].seo?.faq).toEqual([{ question: "Q?", answer: "A." }]);
    expect(stored[0].seo?.secondaryKeywords).toEqual(["road running shoes"]);
    expect(stored[0].seo?.sourceSessionId).toBe("s1");

    // seoTitle is replaced, the untouched h1 survives.
    expect(stored[1].seo?.seoTitle).toBe("Trail Shoes | Store");
    expect(stored[1].seo?.h1).toBe("Old h1");
  });

  it("counts rows that match nothing and rows with no content", async () => {
    const result = await applyPlpWriteBack({
      workspaceId: "w1",
      sessionId: "s1",
      rows: [
        row("Winter Boots", { seoTitle: "Winter Boots | Store" }),
        row("Running Shoes", {}),
      ],
      sourceColumn: "name",
    });

    expect(result).toEqual({ updated: 0, unmatched: 1, skipped: 1 });
    expect(saveCategoriesJson).not.toHaveBeenCalled();
  });

  it("ignores enriched keys that are not category SEO fields", async () => {
    await applyPlpWriteBack({
      workspaceId: "w1",
      sessionId: "s1",
      rows: [row("Running Shoes", { seoTitle: "T", imageUrls: ["x"] })],
      sourceColumn: "name",
    });
    expect(stored[0].seo).not.toHaveProperty("imageUrls");
  });

  it("counts only rows carrying PLP output", () => {
    expect(
      countRowsWithPlpContent([
        row("a", { seoTitle: "T" }),
        row("b", {}),
        row("c", { faq: [] }),
      ])
    ).toBe(1);
  });
});

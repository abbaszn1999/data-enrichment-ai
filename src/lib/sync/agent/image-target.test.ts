import { describe, expect, it } from "vitest";
import type { SyncSheetRow } from "@/lib/sync/core/types";
import {
  buildProductImageQuery,
  isLikelyUserChatInstruction,
  matchRowIndexesByProductName,
  resolveImageSearchTargets,
} from "./image-target";

function row(title: string, extras: Partial<SyncSheetRow> = {}): SyncSheetRow {
  return { title, ...extras };
}

describe("matchRowIndexesByProductName", () => {
  const rows = [
    row("Classic Tee"),
    row("SonicBuds Sport"),
    row("Noise Cancelling Headphones"),
    row("Sport Bottle"),
  ];

  it("finds a named product inside an Arabic image request", () => {
    const matched = matchRowIndexesByProductName(
      rows,
      "أريد ان تضع صورة لي لهذا المنتج SonicBuds Sport"
    );
    expect(matched).toEqual([1]);
  });

  it("finds a product by handle-like phrasing", () => {
    const withHandle = [
      row("Other", { handle: "other" }),
      row("Widget Pro", { handle: "widget-pro" }),
    ];
    expect(
      matchRowIndexesByProductName(withHandle, "add image for widget pro")
    ).toEqual([1]);
  });

  it("returns empty when no product is named", () => {
    expect(
      matchRowIndexesByProductName(rows, "ضع صور لكل المنتجات")
    ).toEqual([]);
  });
});

describe("resolveImageSearchTargets", () => {
  const rows = [
    row("Classic Tee"),
    row("SonicBuds Sport"),
    row("Noise Cancelling Headphones"),
  ];
  const allIndexes = [0, 1, 2];

  it("prefers the product named in the instruction over full-sheet memory", () => {
    const result = resolveImageSearchTargets({
      rows,
      instruction: "أريد صورة لهذا المنتج SonicBuds Sport",
      lastTargetedRowIndexes: allIndexes,
    });
    expect(result).toEqual({
      ok: true,
      indexes: [1],
      reason: "instruction_product_name",
    });
  });

  it("refuses full-sheet remembered targets without a named product", () => {
    const result = resolveImageSearchTargets({
      rows,
      instruction: "ضع صورة للمنتجات",
      lastTargetedRowIndexes: allIndexes,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/whole sheet|specific product/i);
    }
  });

  it("refuses explicit full-sheet rowIndexes without a name match", () => {
    const result = resolveImageSearchTargets({
      rows,
      instruction: "find images",
      explicitRowIndexes: allIndexes,
    });
    expect(result.ok).toBe(false);
  });

  it("allows full-sheet when the user clearly asks for all products", () => {
    const result = resolveImageSearchTargets({
      rows,
      instruction: "ضع صور لكل المنتجات",
      lastTargetedRowIndexes: allIndexes,
    });
    expect(result).toEqual({
      ok: true,
      indexes: allIndexes,
      reason: "remembered_full_sheet_catalog_intent",
    });
  });

  it("accepts explicit subset rowIndexes", () => {
    const result = resolveImageSearchTargets({
      rows,
      instruction: "packshot",
      explicitRowIndexes: [2],
    });
    expect(result).toEqual({
      ok: true,
      indexes: [2],
      reason: "explicit_row_indexes",
    });
  });

  it("uses remembered subset for anaphora", () => {
    const result = resolveImageSearchTargets({
      rows,
      instruction: "ضع لهم صورة",
      lastTargetedRowIndexes: [0, 2],
    });
    expect(result).toEqual({
      ok: true,
      indexes: [0, 2],
      reason: "remembered_subset",
    });
  });

  it("uses newly created rows when nothing else matches", () => {
    const result = resolveImageSearchTargets({
      rows,
      instruction: "add a packshot",
      lastCreatedRowIndexes: [1],
    });
    expect(result).toEqual({
      ok: true,
      indexes: [1],
      reason: "created_rows",
    });
  });

  it("allows the single row on a one-product sheet", () => {
    const result = resolveImageSearchTargets({
      rows: [row("Only One")],
      instruction: "ضع صورة",
      lastTargetedRowIndexes: [0],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.indexes).toEqual([0]);
  });
});

describe("image query helpers", () => {
  it("detects Arabic chat instructions", () => {
    expect(
      isLikelyUserChatInstruction("أريد ان تضع صورة لي لهذا المنتج SonicBuds Sport")
    ).toBe(true);
    expect(isLikelyUserChatInstruction("white background")).toBe(false);
  });

  it("builds identity-only product queries", () => {
    expect(
      buildProductImageQuery(
        row("SonicBuds Sport", { vendor: "Acme", product_type: "Audio", tags: "wireless" })
      )
    ).toBe("SonicBuds Sport Acme Audio wireless");
  });
});

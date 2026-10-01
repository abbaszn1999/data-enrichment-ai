import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage-helpers", () => ({
  saveProjectDelta: async () => ({ ok: true }),
  saveProjectJson: async () => "path",
}));
vi.mock("@/lib/supabase", () => ({ updateImportSession: async () => ({}) }));
vi.mock("@/lib/persistence", () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn(() => null),
  clearSession: vi.fn(),
}));

import { applyColumnLayout } from "@/lib/sheet/column-layout";
import { getDefaultEnrichmentColumns } from "@/types";
import { useSheetStore } from "./sheet-store";

function open() {
  useSheetStore
    .getState()
    .loadProject("w1", "p1", "Sheet", ["Title"], [], ["Title"], getDefaultEnrichmentColumns("product"), {} as never, {}, "product");
  useSheetStore.getState().addCustomEnrichmentColumn({
    label: "Target audience",
    description: "Who it is for",
    type: "text",
  });
}

const ids = () => useSheetStore.getState().enrichmentColumns.map((c) => c.id);

describe("reorderEnrichmentColumns", () => {
  beforeEach(() => open());

  it("brings Source URLs to the front and keeps every column", () => {
    const before = ids();
    useSheetStore.getState().reorderEnrichmentColumns("sourceUrls", "titleTag");
    const after = ids();
    expect(after[0]).toBe("sourceUrls");
    expect(after.slice(1, 5)).toEqual(["titleTag", "marketingDescription", "productSpecifications", "faq"]);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("moves a custom column too, and the sheet follows the same order", () => {
    useSheetStore.getState().reorderEnrichmentColumns("custom_target_audience", "marketingDescription");
    const order = ids();
    expect(order.indexOf("custom_target_audience")).toBe(order.indexOf("marketingDescription") - 1);

    const state = useSheetStore.getState();
    const sheetKeys = applyColumnLayout(
      ["orig:Title", ...state.enrichmentColumns.map((c) => `enrich:${c.id}`)],
      state.columnLayout
    ).filter((key) => key.startsWith("enrich:"));
    expect(sheetKeys.map((key) => key.slice("enrich:".length))).toEqual(order);
  });

  it("a saved preset brings back its columns, instructions, on/off flags and order, on the sheet too", () => {
    useSheetStore.getState().updateEnrichmentColumnConfig("custom_target_audience", {
      customInstruction: "Name the buyer in one line",
    });
    useSheetStore.getState().reorderEnrichmentColumns("custom_target_audience", "titleTag");
    const saved = useSheetStore.getState().enrichmentColumns.map((c) => ({ ...c, enabled: c.id !== "faq" }));

    // Another sheet, opened fresh with the defaults.
    useSheetStore
      .getState()
      .loadProject("w1", "p2", "Other", ["Title"], [], ["Title"], getDefaultEnrichmentColumns("product"), {} as never, {}, "product");
    // This sheet has its own column order before the preset is applied.
    useSheetStore.getState().reorderEnrichmentColumns("sourceUrls", "titleTag");
    useSheetStore.getState().applyEnrichmentPreset({ enrichmentColumns: saved, sourceColumns: ["Title"] });

    const state = useSheetStore.getState();
    expect(ids()).toEqual(saved.map((c) => c.id));
    const custom = state.enrichmentColumns.find((c) => c.id === "custom_target_audience")!;
    expect(custom.customInstruction).toBe("Name the buyer in one line");
    expect(state.enrichmentColumns.find((c) => c.id === "faq")!.enabled).toBe(false);
    const sheetKeys = applyColumnLayout(
      ["orig:Title", ...state.enrichmentColumns.map((c) => `enrich:${c.id}`)],
      state.columnLayout
    ).filter((key) => key.startsWith("enrich:"));
    expect(sheetKeys.map((key) => key.slice("enrich:".length))).toEqual(ids());

    // Still editable after it is applied.
    useSheetStore.getState().updateEnrichmentColumnConfig("custom_target_audience", { customInstruction: "Edited" });
    expect(useSheetStore.getState().enrichmentColumns.find((c) => c.id === "custom_target_audience")!.customInstruction).toBe("Edited");
  });

  it("ignores an unknown column or a drop on itself", () => {
    const before = ids();
    useSheetStore.getState().reorderEnrichmentColumns("nope", "titleTag");
    useSheetStore.getState().reorderEnrichmentColumns("titleTag", "titleTag");
    expect(ids()).toEqual(before);
  });
});

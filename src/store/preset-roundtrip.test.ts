import { beforeEach, describe, expect, it } from "vitest";
import { normalizePresetPayload, presetRowToPreset } from "@/lib/catalog/presets";
import { DEFAULT_ENRICHMENT_SETTINGS, getDefaultEnrichmentColumns } from "@/types";
import { useSheetStore } from "./sheet-store";

describe("a saved Enrichment setting on a later sheet", () => {
  beforeEach(() => {
    useSheetStore.setState({
      sessionKind: "product",
      originalColumns: ["Code", "Description", "Barcode"],
      rows: [],
      enrichmentColumns: getDefaultEnrichmentColumns("product"),
      sourceColumns: [],
      enrichmentSettings: { ...DEFAULT_ENRICHMENT_SETTINGS },
    });
  });

  function saveFromCurrentSheet() {
    const state = useSheetStore.getState();
    const payload = normalizePresetPayload({
      sourceColumns: state.sourceColumns,
      enrichmentColumns: state.enrichmentColumns,
      enrichmentSettings: state.enrichmentSettings,
    });
    expect(payload).not.toBeNull();
    return presetRowToPreset({
      id: "p1",
      kind: "product",
      name: "My setting",
      payload,
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
    });
  }

  it("brings back the custom column, every column instruction, the sources and the instruction for all columns", () => {
    const store = useSheetStore.getState();
    store.addCustomEnrichmentColumn({
      label: "Care tips",
      description: "Care tips",
      customInstruction: "Write three care tips",
      type: "text",
    });
    const custom = useSheetStore.getState().enrichmentColumns.find((c) => c.label === "Care tips")!;
    store.updateEnrichmentColumnConfig("titleTag", { enabled: true, customInstruction: "Titles of 90-100 characters" });
    store.updateEnrichmentColumnConfig(custom.id, { enabled: true });
    useSheetStore.setState({ sourceColumns: ["Code", "Barcode"] });
    store.updateSettings({ globalInstruction: "Scan the barcode first, then find the exact item." });

    const preset = saveFromCurrentSheet();

    // A later sheet: nothing set up yet.
    useSheetStore.setState({
      enrichmentColumns: getDefaultEnrichmentColumns("product"),
      sourceColumns: [],
      enrichmentSettings: { ...DEFAULT_ENRICHMENT_SETTINGS },
    });
    useSheetStore.getState().applyEnrichmentPreset(preset.settings);

    const after = useSheetStore.getState();
    const restoredCustom = after.enrichmentColumns.find((c) => c.id === custom.id);
    expect(restoredCustom).toMatchObject({ label: "Care tips", enabled: true, customInstruction: "Write three care tips", isCustom: true });
    expect(after.enrichmentColumns.find((c) => c.id === "titleTag")).toMatchObject({
      enabled: true,
      customInstruction: "Titles of 90-100 characters",
    });
    expect(after.sourceColumns).toEqual(["Code", "Barcode"]);
    expect(after.enrichmentSettings.globalInstruction).toBe("Scan the barcode first, then find the exact item.");
  });

  it("drops the instruction for all columns when a setting without one, or Default settings, is applied", () => {
    useSheetStore.getState().updateSettings({ globalInstruction: "Use metric units." });

    useSheetStore.getState().applyEnrichmentPreset({
      enrichmentSettings: { ...DEFAULT_ENRICHMENT_SETTINGS },
    });
    expect(useSheetStore.getState().enrichmentSettings.globalInstruction).toBeUndefined();
  });
});

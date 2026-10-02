import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENRICHMENT_SETTINGS } from "@/types";
import { useSheetStore } from "./sheet-store";

describe("Source & Image Finder outputs in the sheet settings", () => {
  beforeEach(() => {
    useSheetStore.setState({ enrichmentSettings: { ...DEFAULT_ENRICHMENT_SETTINGS } });
  });

  it("are unset until the user switches something, so the tab falls back to Images", () => {
    expect(useSheetStore.getState().enrichmentSettings.finderOutputs).toBeUndefined();
  });

  it("keep what the user switched on, and drop anything unknown", () => {
    useSheetStore.getState().updateSettings({ finderOutputs: ["sourceUrls", "images"] });
    expect(useSheetStore.getState().enrichmentSettings.finderOutputs).toEqual(["sourceUrls", "images"]);

    useSheetStore.getState().updateSettings({ finderOutputs: ["sourceUrls", "bogus"] as never });
    expect(useSheetStore.getState().enrichmentSettings.finderOutputs).toEqual(["sourceUrls"]);

    useSheetStore.getState().updateSettings({ finderOutputs: [] });
    expect(useSheetStore.getState().enrichmentSettings.finderOutputs).toEqual([]);
  });

  it("are not changed by applying a saved Enrichment setting", () => {
    useSheetStore.getState().updateSettings({ finderOutputs: ["sourceUrls"] });
    useSheetStore.getState().applyEnrichmentPreset({
      enrichmentSettings: { ...DEFAULT_ENRICHMENT_SETTINGS, outputLanguage: "French" },
    });
    const settings = useSheetStore.getState().enrichmentSettings;
    expect(settings.outputLanguage).toBe("French");
    expect(settings.finderOutputs).toEqual(["sourceUrls"]);
  });
});

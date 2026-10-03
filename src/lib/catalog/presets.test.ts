import { describe, expect, it } from "vitest";
import { normalizePresetPayload, presetRowToPreset } from "./presets";

const col = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  label: id,
  description: id,
  type: "text",
  enabled: true,
  ...extra,
});

describe("normalizePresetPayload", () => {
  it("keeps columns with their custom instructions, sources and language", () => {
    const payload = normalizePresetPayload({
      enrichmentColumns: [col("titleTag", { customInstruction: "Max 60 chars" }), col("faq")],
      sourceColumns: ["Name", "Vendor"],
      enrichmentSettings: { outputLanguage: "Arabic", customLanguage: "", enrichmentModel: "premium", thinkingLevel: "low" },
    });
    expect(payload?.enrichmentColumns.map((c) => c.id)).toEqual(["titleTag", "faq"]);
    expect(payload?.enrichmentColumns[0].customInstruction).toBe("Max 60 chars");
    expect(payload?.sourceColumns).toEqual(["Name", "Vendor"]);
    expect(payload?.enrichmentSettings.outputLanguage).toBe("Arabic");
  });

  it("keeps the instruction for all columns, capped, and leaves it out when empty", () => {
    const withText = normalizePresetPayload({
      enrichmentColumns: [col("faq")],
      enrichmentSettings: { globalInstruction: `  ${"y".repeat(9000)}  ` },
    });
    expect(withText?.enrichmentSettings.globalInstruction).toHaveLength(2000);
    const empty = normalizePresetPayload({
      enrichmentColumns: [col("faq")],
      enrichmentSettings: { globalInstruction: "   " },
    });
    expect(empty?.enrichmentSettings).not.toHaveProperty("globalInstruction");
  });

  it("rejects a preset with no enabled column", () => {
    expect(normalizePresetPayload({ enrichmentColumns: [col("faq", { enabled: false })] })).toBeNull();
    expect(normalizePresetPayload({})).toBeNull();
    expect(normalizePresetPayload("nope")).toBeNull();
  });

  it("drops duplicate and malformed columns and caps a huge instruction", () => {
    const payload = normalizePresetPayload({
      enrichmentColumns: [col("a", { customInstruction: "x".repeat(9000) }), col("a"), { label: "no id" }, null],
    });
    expect(payload?.enrichmentColumns).toHaveLength(1);
    expect(payload?.enrichmentColumns[0].customInstruction).toHaveLength(4000);
  });
});

describe("presetRowToPreset", () => {
  it("maps a table row to the client preset shape", () => {
    const preset = presetRowToPreset({
      id: "p1",
      kind: "plp",
      name: "SEO",
      payload: { enrichmentColumns: [col("faq")], sourceColumns: ["Name"] },
      created_at: "2026-09-30T00:00:00Z",
      updated_at: "2026-09-30T01:00:00Z",
    });
    expect(preset).toMatchObject({ id: "p1", name: "SEO", kind: "plp", updatedAt: "2026-09-30T01:00:00Z" });
    expect(preset.settings.sourceColumns).toEqual(["Name"]);
    expect(preset.settings.enrichmentSettings.outputLanguage).toBe("English");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_SCRAPING_SETTINGS,
} from "@/lib/gallery/types";
import {
  parseGalleryProjectSettings,
  stripNulChars,
} from "@/lib/gallery/settings-schema";

describe("stripNulChars", () => {
  it("removes NUL characters from nested strings and keys", () => {
    expect(
      stripNulChars({ a: "x\u0000y", list: ["p\u0000", 3], "k\u0000": { z: "ok" } })
    ).toEqual({ a: "xy", list: ["p", 3], k: { z: "ok" } });
  });
});

describe("parseGalleryProjectSettings", () => {
  it("accepts instructions that carry a hidden NUL character", () => {
    const parsed = parseGalleryProjectSettings({
      provider: "scraping",
      originalImageColumn: null,
      selectedColumns: [],
      scraping: { ...DEFAULT_SCRAPING_SETTINGS, instructions: "keep\u0000 white" },
      ai: { ...DEFAULT_AI_SETTINGS, instructions: "a\u0000b" },
    });
    expect(parsed.scraping.instructions).toBe("keep white");
    expect(parsed.ai.instructions).toBe("ab");
  });
});

import { describe, expect, it } from "vitest";
import { normalizeDeclaredContentType } from "@/lib/gallery/providers/serper-images";

describe("normalizeDeclaredContentType", () => {
  it("returns empty string for null/empty", () => {
    expect(normalizeDeclaredContentType(null)).toBe("");
    expect(normalizeDeclaredContentType("")).toBe("");
  });

  it("strips parameters", () => {
    expect(normalizeDeclaredContentType("image/png; charset=binary")).toBe(
      "image/png"
    );
  });

  it("takes the first value when Fetch joins duplicate Content-Type headers", () => {
    expect(normalizeDeclaredContentType("image/png, image/png")).toBe(
      "image/png"
    );
    expect(
      normalizeDeclaredContentType("image/jpeg, image/jpeg; charset=utf-8")
    ).toBe("image/jpeg");
  });

  it("lowercases the media type", () => {
    expect(normalizeDeclaredContentType("Image/PNG")).toBe("image/png");
  });
});

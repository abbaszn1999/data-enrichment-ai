import { describe, expect, it } from "vitest";
import { IMAGE_FINDER_SKILL } from "./skill";

describe("IMAGE_FINDER_SKILL", () => {
  it("is a single, direct method — not a multi-phase checklist", () => {
    expect(IMAGE_FINDER_SKILL).not.toContain("PHASE 1");
    expect(IMAGE_FINDER_SKILL).not.toContain("PHASE 2");
    expect(IMAGE_FINDER_SKILL).not.toContain("PHASE 3");
    expect(IMAGE_FINDER_SKILL).toContain("## Method");
  });

  it("tells the model to open pages and report real links it actually saw", () => {
    expect(IMAGE_FINDER_SKILL).toContain("Open the pages that come up");
    expect(IMAGE_FINDER_SKILL).toContain(
      "report the real images shown on it — or found through search — exactly as you saw them"
    );
    expect(IMAGE_FINDER_SKILL).toContain(
      "Never write a link from memory or guess one; only report a link you actually saw"
    );
  });

  it("does not restrict links to a single tool field", () => {
    expect(IMAGE_FINDER_SKILL).not.toContain("image_result");
    expect(IMAGE_FINDER_SKILL).not.toContain("source_website_url");
  });

  it("targets the base product, not a required variant, unless the custom instruction asks for one", () => {
    expect(IMAGE_FINDER_SKILL).toContain(
      "Match a specific variant only when the custom instruction requires one"
    );
  });

  it("keeps searching other confirmed sources instead of stopping at a thin gallery", () => {
    expect(IMAGE_FINDER_SKILL).toContain("open other confirmed pages or sources");
    expect(IMAGE_FINDER_SKILL).toContain("A thin gallery on one site is not a reason to stop");
  });

  it("never substitutes a similar or neighbouring product to fill the count", () => {
    expect(IMAGE_FINDER_SKILL).toContain(
      "Never substitute a similar code's or a neighbouring product's photo just to fill the count"
    );
  });

  it("makes confidence informational only — never a reason to drop an image", () => {
    expect(IMAGE_FINDER_SKILL).toContain(
      "## Confidence is informational, never a reason to drop an image"
    );
    expect(IMAGE_FINDER_SKILL).toContain("Never use confidence to leave an image out");
  });

  it("keeps the empty-list guarantee and an honest not-found standard", () => {
    expect(IMAGE_FINDER_SKILL).toContain("An empty list is a valid, complete answer");
    expect(IMAGE_FINDER_SKILL).toContain(
      "not that the first query came up empty"
    );
  });

  it("keeps the custom instruction above the model's own analysis but below hard/website rules", () => {
    const order = ["Order of authority", "Custom instruction (store owner)"].map((s) =>
      IMAGE_FINDER_SKILL.indexOf(s)
    );
    expect(order[0]).toBeLessThan(order[1]);
    expect(IMAGE_FINDER_SKILL).toContain(
      "1. Hard rules and website rules (below) — enforced by the system, can never be broken."
    );
  });

  it("still enforces website rules", () => {
    expect(IMAGE_FINDER_SKILL).toContain("## Website rules");
    expect(IMAGE_FINDER_SKILL).toContain("Images outside these rules are removed after you answer");
  });
});

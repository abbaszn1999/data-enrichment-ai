import { describe, expect, it } from "vitest";
import { IMAGE_FINDER_SKILL } from "./skill";

describe("IMAGE_FINDER_SKILL", () => {
  it("has no pre-sorted identity phases — one flat method instead", () => {
    expect(IMAGE_FINDER_SKILL).not.toContain("PHASE 1");
    expect(IMAGE_FINDER_SKILL).not.toContain("PHASE 2");
    expect(IMAGE_FINDER_SKILL).not.toContain("PHASE 3");
    expect(IMAGE_FINDER_SKILL).toContain("## Method");
  });

  it("targets the base product, not a required variant, unless the custom instruction asks for one", () => {
    expect(IMAGE_FINDER_SKILL).toContain(
      "the goal is the correct parent product, not a specific variant of it"
    );
    expect(IMAGE_FINDER_SKILL).toContain(
      "Match the specific variant only when the custom instruction requires one"
    );
  });

  it("confirms every matching source, not just the first, and uses all of them as galleries", () => {
    expect(IMAGE_FINDER_SKILL).toContain("Confirm every source you find, not just the first");
    expect(IMAGE_FINDER_SKILL).toContain("they are your galleries");
    expect(IMAGE_FINDER_SKILL).toContain("For each confirmed domain, run a site-restricted image search");
    expect(IMAGE_FINDER_SKILL).toContain("do not stop at the first source if you still need more images");
  });

  it("gives concrete query variety and free page verification", () => {
    expect(IMAGE_FINDER_SKILL).toContain("in quotes");
    expect(IMAGE_FINDER_SKILL).toMatch(/language.*well as in English/i);
    expect(IMAGE_FINDER_SKILL).toMatch(/manufacturer|factory/i);
    expect(IMAGE_FINDER_SKILL).toContain("open_page");
    expect(IMAGE_FINDER_SKILL).toContain("find_in_page");
    expect(IMAGE_FINDER_SKILL).toContain("costs nothing extra");
  });

  it("treats a barcode/SKU conflict as bad data to set aside, deferring to the custom instruction", () => {
    expect(IMAGE_FINDER_SKILL).toContain(
      "a barcode that looks like it belongs to a different product or a different industry than the SKU suggests is bad data"
    );
  });

  it("keeps the empty-list guarantee and an honest not-found standard", () => {
    expect(IMAGE_FINDER_SKILL).toContain("An empty list is a valid, complete answer");
    expect(IMAGE_FINDER_SKILL).toContain(
      "not that the first query came up empty"
    );
  });

  it("keeps the custom instruction above default analysis but below hard/website rules", () => {
    const order = ["Order of authority", "Custom instruction (store owner)"].map((s) =>
      IMAGE_FINDER_SKILL.indexOf(s)
    );
    expect(order[0]).toBeLessThan(order[1]);
    expect(IMAGE_FINDER_SKILL).toContain(
      "Only the hard URL rules and website rules outrank it."
    );
  });

  it("no longer references a pre-sorted identity section in the brief", () => {
    expect(IMAGE_FINDER_SKILL).toContain("there is no pre-sorted");
  });

  it("still carries the hard URL and website enforcement rules", () => {
    expect(IMAGE_FINDER_SKILL).toContain("imageUrls must contain only image_url values");
    expect(IMAGE_FINDER_SKILL).toContain("## Website rules");
  });
});

import { describe, expect, it } from "vitest";
import { IMAGE_FINDER_SKILL } from "./skill";

describe("IMAGE_FINDER_SKILL", () => {
  it("defines the search playbook before the three phases, in order", () => {
    const sections = [
      "## Search playbook",
      "PHASE 1 — Identity lock",
      "PHASE 2 — Coverage expansion",
      "PHASE 3 — Final adversarial check",
    ].map((heading) => IMAGE_FINDER_SKILL.indexOf(heading));
    expect(sections.every((index) => index >= 0)).toBe(true);
    expect([...sections].sort((a, b) => a - b)).toEqual(sections);
  });

  it("gives concrete query techniques per identifier type", () => {
    expect(IMAGE_FINDER_SKILL).toContain("in quotes");
    expect(IMAGE_FINDER_SKILL).toMatch(/language.*well as in English/i);
    expect(IMAGE_FINDER_SKILL).toMatch(/manufacturer|factory/i);
    expect(IMAGE_FINDER_SKILL).toContain("site-restricted image search");
  });

  it("requires opening the page to verify the identifier, and says it costs nothing extra", () => {
    expect(IMAGE_FINDER_SKILL).toContain("open_page");
    expect(IMAGE_FINDER_SKILL).toContain("find_in_page");
    expect(IMAGE_FINDER_SKILL).toContain("costs nothing extra");
  });

  it("defines a confirmed match as two independent signals, not a feeling", () => {
    expect(IMAGE_FINDER_SKILL).toContain("at least two independent signals agree");
    expect(IMAGE_FINDER_SKILL).toContain("A single signal alone");
  });

  it("requires working through the playbook before returning empty", () => {
    expect(IMAGE_FINDER_SKILL).toContain(
      "you may only return an empty list after you have worked through the applicable rows of the search playbook"
    );
    expect(IMAGE_FINDER_SKILL).toContain(
      "not that the first one or two queries came up empty"
    );
  });

  it("reuses the site-restricted search technique for same-source coverage in Phase 2", () => {
    const phase2 = IMAGE_FINDER_SKILL.slice(
      IMAGE_FINDER_SKILL.indexOf("PHASE 2"),
      IMAGE_FINDER_SKILL.indexOf("PHASE 3")
    );
    expect(phase2).toContain("site-restricted image search");
    expect(phase2).toContain("playbook item 6");
  });

  it("keeps the empty-list and no-padding guarantees explicit", () => {
    expect(IMAGE_FINDER_SKILL).toContain("An empty list is a valid, complete answer");
    expect(IMAGE_FINDER_SKILL).toContain("Never lower your standard just to reach the requested count");
  });

  it("keeps the custom instruction above default identity rules but below hard/website rules", () => {
    const order = ["Order of authority", "Custom instruction (store owner)"].map((s) =>
      IMAGE_FINDER_SKILL.indexOf(s)
    );
    expect(order[0]).toBeLessThan(order[1]);
    expect(IMAGE_FINDER_SKILL).toContain(
      "Only the hard URL rules and website rules outrank it."
    );
  });

  it("still carries the hard URL and website enforcement rules", () => {
    expect(IMAGE_FINDER_SKILL).toContain("imageUrls must contain only image_url values");
    expect(IMAGE_FINDER_SKILL).toContain("## Website rules");
  });
});

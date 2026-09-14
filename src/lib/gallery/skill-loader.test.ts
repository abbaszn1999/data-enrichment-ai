import { describe, expect, it } from "vitest";
import {
  getAllGallerySkills,
  loadGallerySkill,
  parseGallerySkillMarkdown,
} from "./skill-loader";

describe("gallery skill-loader", () => {
  it("parses YAML frontmatter and keeps the markdown body as instructions", () => {
    const skill = parseGallerySkillMarkdown(
      [
        "---",
        "id: planner",
        "order: 1",
        "thinking: high",
        'output: "briefs"',
        "---",
        "",
        "# Planner",
        "",
        "Honor Gallery custom instructions.",
      ].join("\n"),
      "01-planner.md"
    );
    expect(skill.frontmatter).toEqual({
      id: "planner",
      order: 1,
      thinking: "high",
      output: "briefs",
    });
    expect(skill.instructions).toContain("Honor Gallery custom instructions");
  });

  it("rejects a missing frontmatter fence", () => {
    expect(() => parseGallerySkillMarkdown("# no fence", "x.md")).toThrow(
      /frontmatter/i
    );
  });

  it("loads both shipped skills from disk in order", async () => {
    const skills = await getAllGallerySkills();
    expect(skills.map((s) => s.frontmatter.id)).toEqual(["planner", "image"]);
    expect(skills[0].frontmatter.thinking).toBe("high");
    expect(skills[0].instructions).toMatch(/custom instructions/i);
    expect(skills[0].instructions).toMatch(/never invent/i);
    expect(skills[1].instructions).toMatch(/identity lock/i);
    expect(skills[1].instructions).toMatch(/do not add quality-spam/i);
  });

  it("caches loadGallerySkill by id", async () => {
    const a = await loadGallerySkill("planner");
    const b = await loadGallerySkill("planner");
    expect(a).toBe(b);
  });
});

import { describe, expect, it } from "vitest";
import {
  getAllVisualizerSkills,
  loadVisualizerSkill,
  parseVisualizerSkillMarkdown,
} from "./skill-loader";

describe("visualizer skill-loader", () => {
  it("parses YAML frontmatter and keeps the markdown body as instructions", () => {
    const skill = parseVisualizerSkillMarkdown(
      [
        "---",
        "id: description",
        "order: 1",
        "thinking: high",
        'output: "html plus briefs"',
        "---",
        "",
        "# Description",
        "",
        "Inventory every specification.",
      ].join("\n"),
      "01-description.md"
    );
    expect(skill.frontmatter).toEqual({
      id: "description",
      order: 1,
      thinking: "high",
      output: "html plus briefs",
    });
    expect(skill.instructions).toContain("Inventory every specification");
  });

  it("rejects a missing frontmatter fence", () => {
    expect(() => parseVisualizerSkillMarkdown("# no fence", "x.md")).toThrow(
      /frontmatter/i
    );
  });

  it("loads both shipped skills from disk in order", async () => {
    const skills = await getAllVisualizerSkills();
    expect(skills.map((s) => s.frontmatter.id)).toEqual(["description", "image"]);
    expect(skills[0].frontmatter.thinking).toBe("high");
    expect(skills[0].instructions).toMatch(/spec inventory|Inventory every specification/i);
    expect(skills[0].instructions).toMatch(/visual proof|visually prove|prove/i);
    expect(skills[0].instructions).toMatch(/quality spam/i);
    expect(skills[1].instructions).toMatch(/identity lock/i);
    expect(skills[1].instructions).toMatch(/do not add quality-spam/i);
  });

  it("caches loadVisualizerSkill by id", async () => {
    const a = await loadVisualizerSkill("description");
    const b = await loadVisualizerSkill("description");
    expect(a).toBe(b);
  });
});
